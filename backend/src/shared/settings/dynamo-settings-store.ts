import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import {
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb'
import {
  SettingsConflictError,
  type EditableSettings,
  type SettingsStore,
  type StoredSettings
} from './editable-settings.js'

const SETTINGS_ID = 'settings'
const ENTITY_TYPE = 'settings'

/** Drops keys whose value is `undefined`, which DynamoDB cannot store. */
function cleanValues(values: Partial<EditableSettings>): Partial<EditableSettings> {
  const cleaned = { ...values }
  for (const key of Object.keys(cleaned) as (keyof EditableSettings)[]) {
    if (cleaned[key] === undefined) {
      delete cleaned[key]
    }
  }
  return cleaned
}

/**
 * `SettingsStore` backed by a single DynamoDB record (`id: "settings"`) with a
 * numeric version. Saves are conditional: `attribute_not_exists` for the first
 * write, `version = :expected` afterwards, so concurrent saves conflict.
 */
export function createDynamoSettingsStore({
  client,
  tableName
}: {
  client: DynamoDBDocumentClient
  tableName: string
}): SettingsStore {
  return {
    async get(): Promise<StoredSettings | null> {
      const result = await client.send(
        new GetCommand({ TableName: tableName, Key: { id: SETTINGS_ID } })
      )
      if (result.Item === undefined) return null
      return {
        version: result.Item.version as number,
        values: result.Item.values as Partial<EditableSettings>
      }
    },

    async save(
      values: Partial<EditableSettings>,
      expectedVersion: number
    ): Promise<{ version: number }> {
      const version = expectedVersion + 1
      const item = {
        id: SETTINGS_ID,
        entityType: ENTITY_TYPE,
        createdAt: new Date().toISOString(),
        version,
        values: cleanValues(values)
      }

      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression:
              expectedVersion === 0
                ? 'attribute_not_exists(#id)'
                : '#version = :expected',
            ExpressionAttributeNames:
              expectedVersion === 0 ? { '#id': 'id' } : { '#version': 'version' },
            ...(expectedVersion === 0
              ? {}
              : { ExpressionAttributeValues: { ':expected': expectedVersion } })
          })
        )
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          throw new SettingsConflictError()
        }
        throw error
      }

      return { version }
    }
  }
}
