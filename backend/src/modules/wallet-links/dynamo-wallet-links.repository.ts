import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb'
import { ConflictError } from '../payments/payments.repository.js'
import type { WalletLink } from './wallet-link.types.js'
import type { WalletLinksRepository } from './wallet-links.repository.js'

/** `spend#<linkId>#<periodStart>` lives outside the `byType` and `byUser` indexes. */
const spendKey = (linkId: string, periodStart: string): string =>
  `spend#${linkId}#${periodStart}`

const TWO_DAYS_SECONDS = 2 * 24 * 3600
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

/** Amounts travel as integer strings; validate with `BigInt`, write with `Number`. */
const parseMinor = (value: string, label: string): bigint => {
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    throw new Error(`Invalid ${label} amount: ${value}`)
  }
  if (parsed < 0n) {
    throw new Error(`Negative ${label} amount: ${value}`)
  }
  return parsed
}

/** Daily amounts fit in 2^53; reject clearly if they do not. */
const toNumber = (value: bigint): number => {
  if (value > MAX_SAFE_BIGINT) {
    throw new Error(`Amount ${value} exceeds the safe integer range`)
  }
  return Number(value)
}

/**
 * DynamoDB implementation of `WalletLinksRepository` (spec 023, lote 2). Uses
 * the existing single table (`id` key, `byType` and `byUser` indexes); a wallet
 * link is one item (`entityType = 'walletLink'`) and each period's spend is a
 * separate item without `entityType`/`userId`, so it never enters the indexes.
 */
export function createDynamoWalletLinksRepository({
  client,
  tableName
}: {
  client: DynamoDBDocumentClient
  tableName: string
}): WalletLinksRepository {
  const toItem = (link: WalletLink): Record<string, unknown> => {
    const item: Record<string, unknown> = { ...link, entityType: 'walletLink' }
    for (const key of Object.keys(item)) {
      if (item[key] === undefined) delete item[key]
    }
    return item
  }

  const toWalletLink = (item: Record<string, unknown>): WalletLink => {
    const link = { ...item }
    delete link.entityType
    return link as unknown as WalletLink
  }

  const readSpent = async (linkId: string, periodStart: string): Promise<string> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { id: spendKey(linkId, periodStart) }
      })
    )
    const spent = result.Item?.spent as number | undefined
    return spent === undefined ? '0' : String(spent)
  }

  const queryByUser = async (
    userId: string,
    status?: WalletLink['status']
  ): Promise<WalletLink[]> => {
    const links: WalletLink[] = []
    let lastEvaluatedKey: Record<string, unknown> | undefined
    const names: Record<string, string> = { '#userId': 'userId' }
    const values: Record<string, unknown> = {
      ':userId': userId,
      ':entityType': 'walletLink'
    }
    let filterExpression = 'entityType = :entityType'
    if (status !== undefined) {
      names['#status'] = 'status'
      values[':status'] = status
      filterExpression += ' AND #status = :status'
    }

    do {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'byUser',
          KeyConditionExpression: '#userId = :userId',
          FilterExpression: filterExpression,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ScanIndexForward: false,
          ...(lastEvaluatedKey !== undefined
            ? { ExclusiveStartKey: lastEvaluatedKey }
            : {})
        })
      )
      for (const item of result.Items ?? []) {
        links.push(toWalletLink(item))
      }
      lastEvaluatedKey = result.LastEvaluatedKey
    } while (lastEvaluatedKey !== undefined)

    return links
  }

  return {
    async create(link) {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: toItem(link),
            ConditionExpression: 'attribute_not_exists(#id)',
            ExpressionAttributeNames: { '#id': 'id' }
          })
        )
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          throw new ConflictError(`Wallet link ${link.id} already exists`)
        }
        throw error
      }
    },

    async get(id) {
      const result = await client.send(
        new GetCommand({ TableName: tableName, Key: { id } })
      )
      return result.Item === undefined ? null : toWalletLink(result.Item)
    },

    async findLatestByUser(userId) {
      const links = await queryByUser(userId)
      return links[0] ?? null
    },

    async findActiveByUser(userId) {
      const links = await queryByUser(userId, 'ACTIVE')
      return links[0] ?? null
    },

    async update(id, changes, cond) {
      const names: Record<string, string> = { '#id': 'id' }
      const values: Record<string, unknown> = {}
      const setParts: string[] = []
      const removeParts: string[] = []
      const conditions = ['attribute_exists(#id)']

      if (cond?.expectedStatus !== undefined) {
        names['#status'] = 'status'
        values[':expectedStatus'] = cond.expectedStatus
        conditions.push('#status = :expectedStatus')
      }
      if (cond?.expectedTokenVersion !== undefined) {
        names['#tokenVersion'] = 'tokenVersion'
        values[':expectedTokenVersion'] = cond.expectedTokenVersion
        conditions.push('#tokenVersion = :expectedTokenVersion')
      }

      for (const [field, value] of Object.entries(changes as Record<string, unknown>)) {
        const nameKey = `#${field}`
        names[nameKey] = field
        if (value === undefined) {
          removeParts.push(nameKey)
        } else {
          const valueKey = `:${field}`
          values[valueKey] = value
          setParts.push(`${nameKey} = ${valueKey}`)
        }
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
            ConditionExpression: conditions.join(' AND '),
            ExpressionAttributeNames: names,
            ...(Object.keys(values).length > 0
              ? { ExpressionAttributeValues: values }
              : {}),
            UpdateExpression: updateExpression,
            ReturnValues: 'ALL_NEW'
          })
        )
        return toWalletLink(result.Attributes ?? {})
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          throw new ConflictError(`Wallet link ${id} does not exist or condition failed`)
        }
        throw error
      }
    },

    async getSpent(linkId, periodStart) {
      return readSpent(linkId, periodStart)
    },

    async reserve({ linkId, periodStart, amount, limit }) {
      const amountBig = parseMinor(amount, 'reservation')
      const limitBig = parseMinor(limit, 'limit')

      // A single reservation over the limit never writes: `attribute_not_exists`
      // would otherwise create the counter on a rejected reservation.
      if (amountBig > limitBig) {
        return { ok: false, spent: await readSpent(linkId, periodStart) }
      }

      const maxBefore = limitBig - amountBig
      const ttl = Math.floor(Date.parse(periodStart) / 1000) + TWO_DAYS_SECONDS

      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id: spendKey(linkId, periodStart) },
            UpdateExpression:
              'SET spent = if_not_exists(spent, :zero) + :amount, expiresAt = :ttl',
            ConditionExpression: 'attribute_not_exists(spent) OR spent <= :maxBefore',
            ExpressionAttributeValues: {
              ':zero': 0,
              ':amount': toNumber(amountBig),
              ':ttl': ttl,
              ':maxBefore': toNumber(maxBefore)
            },
            ReturnValues: 'ALL_NEW'
          })
        )
        const spent = String(result.Attributes?.spent ?? 0)
        return { ok: true, spent }
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          return { ok: false, spent: await readSpent(linkId, periodStart) }
        }
        throw error
      }
    },

    async release({ linkId, periodStart, amount }) {
      const amountBig = parseMinor(amount, 'release')
      const amountNumber = toNumber(amountBig)
      const key = { id: spendKey(linkId, periodStart) }

      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: key,
            UpdateExpression: 'SET spent = spent - :amount',
            ConditionExpression: 'attribute_exists(spent) AND spent >= :amount',
            ExpressionAttributeValues: { ':amount': amountNumber }
          })
        )
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error
        // Not enough reserved (or no counter): clamp to zero without creating one.
        try {
          await client.send(
            new UpdateCommand({
              TableName: tableName,
              Key: key,
              UpdateExpression: 'SET spent = :zero',
              ConditionExpression: 'spent < :amount',
              ExpressionAttributeValues: { ':zero': 0, ':amount': amountNumber }
            })
          )
        } catch (secondError) {
          if (!(secondError instanceof ConditionalCheckFailedException)) throw secondError
        }
      }
    }
  }
}
