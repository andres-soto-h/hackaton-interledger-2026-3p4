import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb'
import type { BeginResult, IdempotencyStore } from './store.js'

export interface DynamoIdempotencyStoreOptions {
  client: DynamoDBDocumentClient
  tableName: string
  /** Milliseconds since the epoch. */
  now?: () => number
}

/**
 * Idempotency records in the single table: `id` is the `idem_<hash>` key and
 * `expiresAt` the TTL in epoch seconds. DynamoDB deletes expired items with
 * a delay, so every read also checks `expiresAt` itself.
 */
export function createDynamoIdempotencyStore({
  client,
  tableName,
  now = Date.now
}: DynamoIdempotencyStoreOptions): IdempotencyStore {
  const nowSeconds = (): number => Math.floor(now() / 1000)

  const classify = async (key: string, bodyHash: string): Promise<BeginResult | null> => {
    const { Item } = await client.send(
      new GetCommand({ TableName: tableName, Key: { id: key }, ConsistentRead: true })
    )
    if (Item === undefined || (Item.expiresAt as number) <= nowSeconds()) return null
    if (Item.phase === 'in_progress') return { kind: 'in_progress' }
    if (Item.bodyHash === bodyHash) {
      return { kind: 'replay', status: Item.status as number, body: Item.body }
    }
    return { kind: 'mismatch' }
  }

  return {
    async begin(key, bodyHash, ttlSeconds): Promise<BeginResult> {
      const seconds = nowSeconds()
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              id: key,
              entityType: 'idempotency',
              phase: 'in_progress',
              bodyHash,
              expiresAt: seconds + ttlSeconds
            },
            ConditionExpression: 'attribute_not_exists(id) OR expiresAt <= :now',
            ExpressionAttributeValues: { ':now': seconds }
          })
        )
        return { kind: 'new' }
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error
      }
      // The record may expire or be released between the failed put and the read.
      return (await classify(key, bodyHash)) ?? { kind: 'in_progress' }
    },

    async complete(key, status, body): Promise<void> {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id: key },
            UpdateExpression: 'SET phase = :phase, #status = :status, #body = :body',
            ConditionExpression: 'attribute_exists(id)',
            ExpressionAttributeNames: { '#status': 'status', '#body': 'body' },
            ExpressionAttributeValues: {
              ':phase': 'complete',
              ':status': status,
              ':body': body
            }
          })
        )
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error
      }
    },

    async release(key): Promise<void> {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { id: key } }))
    }
  }
}
