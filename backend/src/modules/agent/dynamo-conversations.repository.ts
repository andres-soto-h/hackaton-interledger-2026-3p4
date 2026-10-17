import {
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb'
import type { AgentHistoryMessage } from './agent.types.js'
import type { ConversationsRepository } from './conversations.repository.js'

const keyOf = (id: string): string => `conv#${id}`

/**
 * Conversations in the single table: `id` is `conv#<conversationId>` and
 * `expiresAt` the TTL in epoch seconds. The owner is stored as `ownerId` (not
 * `userId`) so these items never enter the sparse `byUser` index.
 */
export function createDynamoConversationsRepository({
  client,
  tableName
}: {
  client: DynamoDBDocumentClient
  tableName: string
}): ConversationsRepository {
  return {
    async get(id, userId, nowSeconds) {
      const { Item } = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { id: keyOf(id) },
          ConsistentRead: true
        })
      )
      if (Item === undefined) return null
      if (Item['ownerId'] !== userId || (Item['expiresAt'] as number) <= nowSeconds)
        return null
      return {
        id,
        userId,
        messages: Item['messages'] as AgentHistoryMessage[],
        expiresAt: Item['expiresAt'] as number
      }
    },

    async save(conversation) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            id: keyOf(conversation.id),
            entityType: 'conversation',
            ownerId: conversation.userId,
            messages: conversation.messages,
            expiresAt: conversation.expiresAt
          }
        })
      )
    }
  }
}
