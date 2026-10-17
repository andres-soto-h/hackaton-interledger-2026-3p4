import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb'
import type {
  Payment,
  PaymentRequest,
  PaymentRequestStatus,
  PaymentStatus
} from './payment.types.js'
import {
  ConflictError,
  type ListByWalletQuery,
  type PaymentsRepository
} from './payments.repository.js'

type Item = Payment | PaymentRequest

type IndexName = 'bySender' | 'byReceiver'

interface Position {
  createdAt: string
  id: string
}

/**
 * Opaque cursor: base64 of JSON with the position of each index, so pagination
 * resumes after the last item consumed from every index. Both directions use
 * the same format; only the indexes actually queried carry a position.
 */
interface ListCursor {
  sender?: Position
  receiver?: Position
}

interface Stream {
  peek: () => Promise<Item | null>
  next: () => Promise<Item | null>
  lastKey: () => Position | null
}

const encodeCursor = (cursor: ListCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64')

const decodeCursor = (cursor: string): ListCursor =>
  JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as ListCursor

const matchesKind = (item: Item, kind: ListByWalletQuery['kind']): boolean => {
  switch (kind) {
    case 'payment':
      return item.id.startsWith('pay_')
    case 'payment-request':
      return item.id.startsWith('pr_')
    case 'all':
      return true
  }
}

const matchesStatus = (item: Item, status?: string): boolean =>
  status === undefined || item.status === status

/** Newest first; on equal `createdAt`, breaks ties by descending `id`. */
const compare = (a: Item, b: Item): number => {
  if (a.createdAt > b.createdAt) return -1
  if (a.createdAt < b.createdAt) return 1
  if (a.id > b.id) return -1
  if (a.id < b.id) return 1
  return 0
}

const positionOf = (item: Item): Position => ({
  createdAt: item.createdAt,
  id: item.id
})

const indexKeyName = (index: IndexName): string =>
  index === 'bySender' ? 'senderWalletAddress' : 'receiverWalletAddress'

/**
 * DynamoDB implementation of `PaymentsRepository` for Lambda. One table, keyed
 * by `id`; payments and requests are distinguished by the `id` prefix. Reads by
 * wallet use the `bySender` and `byReceiver` secondary indexes.
 */
export function createDynamoPaymentsRepository({
  client,
  tableName
}: {
  client: DynamoDBDocumentClient
  tableName: string
}): PaymentsRepository {
  const toDynamoItem = (value: unknown): Record<string, unknown> =>
    value as Record<string, unknown>

  async function queryPage(
    index: IndexName,
    walletAddress: string,
    start: Position | undefined
  ): Promise<{ items: Item[]; next: Position | undefined }> {
    const keyName = indexKeyName(index)
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: index,
        KeyConditionExpression: '#pk = :wallet',
        ExpressionAttributeNames: { '#pk': keyName },
        ExpressionAttributeValues: { ':wallet': walletAddress },
        ScanIndexForward: false,
        ...(start
          ? {
              ExclusiveStartKey: {
                [keyName]: walletAddress,
                createdAt: start.createdAt,
                id: start.id
              }
            }
          : {})
      })
    )

    const items = (result.Items ?? []) as Item[]
    const lastEvaluatedKey = result.LastEvaluatedKey
    return {
      items,
      next: lastEvaluatedKey
        ? {
            createdAt: lastEvaluatedKey['createdAt'] as string,
            id: lastEvaluatedKey['id'] as string
          }
        : undefined
    }
  }

  function makeStream(
    index: IndexName,
    walletAddress: string,
    start: Position | undefined,
    kind: ListByWalletQuery['kind'],
    status?: string
  ): Stream {
    let buffer: Item[] = []
    let startKey = start
    let last: Position | null = null
    let exhausted = false

    const peek = async (): Promise<Item | null> => {
      while (buffer.length === 0 && !exhausted) {
        const page = await queryPage(index, walletAddress, startKey)
        buffer = page.items.filter(
          (item) => matchesKind(item, kind) && matchesStatus(item, status)
        )
        startKey = page.next
        exhausted = page.next === undefined
      }
      return buffer[0] ?? null
    }

    const next = async (): Promise<Item | null> => {
      const item = await peek()
      if (item) {
        buffer = buffer.slice(1)
        last = positionOf(item)
      }
      return item
    }

    return { peek, next, lastKey: () => last }
  }

  return {
    async createPayment(payment) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: toDynamoItem(payment),
          ConditionExpression: 'attribute_not_exists(#id)',
          ExpressionAttributeNames: { '#id': 'id' }
        })
      )
    },

    async getPayment(id) {
      const result = await client.send(
        new GetCommand({ TableName: tableName, Key: { id } })
      )
      return result.Item ? (result.Item as unknown as Payment) : null
    },

    async updatePayment(id, changes, opts) {
      const raw = changes as Record<string, unknown>
      const newStatus = raw['status'] as PaymentStatus | undefined
      const expiresAt = raw['expiresAt'] as number | undefined

      const names: Record<string, string> = { '#id': 'id', '#status': 'status' }
      const values: Record<string, unknown> = {
        ':expected': opts.expectedStatus
      }
      const setParts: string[] = []
      const removeParts: string[] = []

      for (const [field, value] of Object.entries(raw)) {
        if (field === 'status' || field === 'expiresAt') continue
        if (value === undefined) continue
        const nameKey = `#${field}`
        const valueKey = `:${field}`
        names[nameKey] = field
        values[valueKey] = value
        setParts.push(`${nameKey} = ${valueKey}`)
      }

      const finalStatus = newStatus ?? opts.expectedStatus

      if (newStatus !== undefined) {
        setParts.push('#status = :status')
        values[':status'] = newStatus
      }

      if (finalStatus !== 'AWAITING_CONFIRMATION') {
        names['#expiresAt'] = 'expiresAt'
        removeParts.push('#expiresAt')
      } else if (expiresAt !== undefined) {
        names['#expiresAt'] = 'expiresAt'
        values[':expiresAt'] = expiresAt
        setParts.push('#expiresAt = :expiresAt')
      }

      const updateExpression = [
        setParts.length > 0 ? `SET ${setParts.join(', ')}` : '',
        removeParts.length > 0 ? `REMOVE ${removeParts.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join(' ')

      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id },
            ConditionExpression: 'attribute_exists(#id) AND #status = :expected',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            UpdateExpression: updateExpression,
            ReturnValues: 'ALL_NEW'
          })
        )
        return result.Attributes as unknown as Payment
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          throw new ConflictError(
            `Payment ${id} does not exist or status is not ${opts.expectedStatus}`
          )
        }
        throw error
      }
    },

    async createPaymentRequest(request) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: toDynamoItem(request),
          ConditionExpression: 'attribute_not_exists(#id)',
          ExpressionAttributeNames: { '#id': 'id' }
        })
      )
    },

    /**
     * Full scan filtered by the `pay_` id prefix. Fine for the low volume of the
     * admin summary; if it grows, move the aggregate to a counter item.
     */
    async listAllPayments() {
      const items: Payment[] = []
      let startKey: Record<string, unknown> | undefined
      do {
        const result = await client.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: 'begins_with(#id, :prefix)',
            ExpressionAttributeNames: { '#id': 'id' },
            ExpressionAttributeValues: { ':prefix': 'pay_' },
            ExclusiveStartKey: startKey
          })
        )
        items.push(...((result.Items ?? []) as unknown as Payment[]))
        startKey = result.LastEvaluatedKey
      } while (startKey !== undefined)
      return items
    },

    async getPaymentRequest(id) {
      const result = await client.send(
        new GetCommand({ TableName: tableName, Key: { id } })
      )
      return result.Item ? (result.Item as unknown as PaymentRequest) : null
    },

    async updatePaymentRequest(id, changes, opts) {
      const raw = changes as Record<string, unknown>
      const newStatus = raw['status'] as PaymentRequestStatus | undefined

      const names: Record<string, string> = { '#id': 'id', '#status': 'status' }
      const values: Record<string, unknown> = { ':expected': opts.expectedStatus }
      const setParts: string[] = []

      for (const [field, value] of Object.entries(raw)) {
        if (field === 'status') continue
        if (value === undefined) continue
        const nameKey = `#${field}`
        const valueKey = `:${field}`
        names[nameKey] = field
        values[valueKey] = value
        setParts.push(`${nameKey} = ${valueKey}`)
      }

      if (newStatus !== undefined) {
        setParts.push('#status = :status')
        values[':status'] = newStatus
      }

      const updateExpression = setParts.length > 0 ? `SET ${setParts.join(', ')}` : ''

      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id },
            ConditionExpression: 'attribute_exists(#id) AND #status = :expected',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            UpdateExpression: updateExpression,
            ReturnValues: 'ALL_NEW'
          })
        )
        return result.Attributes as unknown as PaymentRequest
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          throw new ConflictError(
            `Payment request ${id} does not exist or status is not ${opts.expectedStatus}`
          )
        }
        throw error
      }
    },

    async listByWallet(q) {
      const cursor = q.cursor !== undefined ? decodeCursor(q.cursor) : {}

      const queries: { index: IndexName; stream: Stream }[] = []
      if (q.direction !== 'incoming') {
        queries.push({
          index: 'bySender',
          stream: makeStream('bySender', q.walletAddress, cursor.sender, q.kind, q.status)
        })
      }
      if (q.direction !== 'outgoing') {
        queries.push({
          index: 'byReceiver',
          stream: makeStream(
            'byReceiver',
            q.walletAddress,
            cursor.receiver,
            q.kind,
            q.status
          )
        })
      }

      const streams = queries.map((query) => query.stream)
      const items: Item[] = []
      const emitted = new Set<string>()

      while (items.length < q.limit) {
        const heads = await Promise.all(streams.map((stream) => stream.peek()))
        let chosenIdx = -1
        let chosen: Item | null = null
        for (let i = 0; i < heads.length; i++) {
          const head = heads[i]
          if (!head) continue
          if (chosen === null || compare(head, chosen) < 0) {
            chosen = head
            chosenIdx = i
          }
        }

        if (chosen === null) break

        await streams[chosenIdx]!.next()

        // Drop the same item from the other index (a payment sent to oneself
        // shows up in both indexes).
        for (let i = 0; i < streams.length; i++) {
          if (i === chosenIdx) continue
          const other = await streams[i]!.peek()
          if (other && other.id === chosen.id) {
            await streams[i]!.next()
          }
        }

        if (!emitted.has(chosen.id)) {
          emitted.add(chosen.id)
          items.push(chosen)
        }
      }

      const hasMore = (await Promise.all(streams.map((stream) => stream.peek()))).some(
        (head) => head !== null
      )

      if (!hasMore) {
        return { items }
      }

      const nextCursor: ListCursor = {}
      for (const query of queries) {
        const position =
          query.stream.lastKey() ??
          cursor[query.index === 'bySender' ? 'sender' : 'receiver']
        if (position) {
          if (query.index === 'bySender') {
            nextCursor.sender = position
          } else {
            nextCursor.receiver = position
          }
        }
      }

      return { items, nextCursor: encodeCursor(nextCursor) }
    }
  }
}
