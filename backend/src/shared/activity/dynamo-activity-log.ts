import {
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb'
import { newId } from '../ids/ids.js'
import type {
  ActivityEvent,
  ActivityEventInput,
  ActivityLevel,
  ActivityListOptions,
  ActivityListResult,
  ActivityLog
} from './activity-log.js'
import { sanitizeEventData } from './event-types.js'

const DAY_SECONDS = 86_400
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100
const EVENT_ENTITY_TYPE = 'event'

interface Position {
  createdAt: string
  seq: number
  id: string
}

/** DynamoDB item as stored (and returned) for an activity event. */
interface RawEvent {
  id: string
  entityType: string
  createdAt: string
  seq: number
  level: ActivityLevel
  type: string
  paymentId?: string
  requestId?: string
  message: string
  data: Record<string, string>
  expiresAt: number
}

export interface DynamoActivityLogOptions {
  client: DynamoDBDocumentClient
  tableName: string
  now?: () => number
}

const encodeCursor = (position: Position): string =>
  Buffer.from(`${position.createdAt}|${position.seq}|${position.id}`).toString('base64')

const decodeCursor = (cursor: string): Position => {
  const [createdAt = '', seq = '0', id = ''] = Buffer.from(cursor, 'base64')
    .toString('utf8')
    .split('|')
  return { createdAt, seq: Number(seq), id }
}

const positionOf = (event: RawEvent): Position => ({
  createdAt: event.createdAt,
  seq: event.seq,
  id: event.id
})

/** Ascending order by `(createdAt, seq, id)`: `seq` breaks same-millisecond ties. */
const comparePosition = (a: Position, b: Position): number => {
  if (a.createdAt < b.createdAt) return -1
  if (a.createdAt > b.createdAt) return 1
  if (a.seq < b.seq) return -1
  if (a.seq > b.seq) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

const toEvent = (raw: RawEvent): ActivityEvent => ({
  id: raw.id,
  createdAt: raw.createdAt,
  level: raw.level,
  type: raw.type,
  ...(raw.paymentId !== undefined ? { paymentId: raw.paymentId } : {}),
  ...(raw.requestId !== undefined ? { requestId: raw.requestId } : {}),
  message: raw.message,
  data: raw.data,
  expiresAt: raw.expiresAt
})

/**
 * DynamoDB `ActivityLog`. Events live in the same table keyed by `id`, with
 * `entityType: "event"`. Reads use `byPayment` when filtering by payment, else
 * `byType` (`entityType = "event"`). The index sort key is only `createdAt`,
 * so a per-instance `seq` breaks same-millisecond ties and the opaque cursor
 * is `createdAt|seq|id` (base64).
 */
export function createDynamoActivityLog({
  client,
  tableName,
  now = () => Date.now()
}: DynamoActivityLogOptions): ActivityLog {
  let seq = 0

  return {
    async record(input: ActivityEventInput): Promise<ActivityEvent> {
      const timestamp = now()
      seq += 1
      const event: ActivityEvent = {
        id: newId('evt', timestamp),
        createdAt: new Date(timestamp).toISOString(),
        level: input.level ?? 'info',
        type: input.type,
        ...(input.paymentId !== undefined ? { paymentId: input.paymentId } : {}),
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        message: input.message,
        data: sanitizeEventData(input.type, input.data),
        expiresAt: Math.floor(timestamp / 1000) + 7 * DAY_SECONDS
      }

      const item: RawEvent = {
        id: event.id,
        entityType: EVENT_ENTITY_TYPE,
        createdAt: event.createdAt,
        seq,
        level: event.level,
        type: event.type,
        ...(event.paymentId !== undefined ? { paymentId: event.paymentId } : {}),
        ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
        message: event.message,
        data: event.data,
        expiresAt: event.expiresAt
      }

      await client.send(new PutCommand({ TableName: tableName, Item: item }))
      return event
    },

    async list(options: ActivityListOptions = {}): Promise<ActivityListResult> {
      const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      const cursor = options.after !== undefined ? decodeCursor(options.after) : null

      const indexName = options.paymentId !== undefined ? 'byPayment' : 'byType'
      const hashKeyName = options.paymentId !== undefined ? 'paymentId' : 'entityType'
      const hashValue = options.paymentId ?? EVENT_ENTITY_TYPE

      const names: Record<string, string> = { '#pk': hashKeyName }
      const values: Record<string, unknown> = { ':pk': hashValue }

      let keyCondition = '#pk = :pk'
      if (cursor !== null) {
        names['#createdAt'] = 'createdAt'
        values[':createdAt'] = cursor.createdAt
        keyCondition += ' AND #createdAt >= :createdAt'
      }

      const filterParts: string[] = []
      if (options.type !== undefined) {
        names['#type'] = 'type'
        values[':type'] = options.type
        filterParts.push('#type = :type')
      }
      if (options.level !== undefined) {
        names['#level'] = 'level'
        values[':level'] = options.level
        filterParts.push('#level = :level')
      }

      const raw: RawEvent[] = []
      let lastEvaluatedKey: Record<string, unknown> | undefined

      do {
        const result = await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: indexName,
            KeyConditionExpression: keyCondition,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ...(filterParts.length > 0
              ? { FilterExpression: filterParts.join(' AND ') }
              : {}),
            ScanIndexForward: true,
            ...(lastEvaluatedKey !== undefined
              ? { ExclusiveStartKey: lastEvaluatedKey }
              : {})
          })
        )

        for (const item of (result.Items ?? []) as RawEvent[]) {
          if (cursor !== null && comparePosition(positionOf(item), cursor) <= 0) {
            continue
          }
          raw.push(item)
        }

        lastEvaluatedKey = result.LastEvaluatedKey
      } while (lastEvaluatedKey !== undefined)

      raw.sort((a, b) => comparePosition(positionOf(a), positionOf(b)))

      const items = raw.slice(0, limit).map(toEvent)

      let nextCursor: string | undefined
      if (items.length > 0) {
        nextCursor = encodeCursor(positionOf(raw[items.length - 1]!))
      } else if (options.after !== undefined) {
        nextCursor = options.after
      }

      return nextCursor !== undefined ? { items, nextCursor } : { items }
    }
  }
}
