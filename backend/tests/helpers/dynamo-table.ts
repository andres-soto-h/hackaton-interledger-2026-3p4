import { randomUUID } from 'node:crypto'
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

// DynamoDB Local (see `pnpm test:dynamo`); fake credentials, never real AWS.
export const rawClient = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
})
export const documentClient = DynamoDBDocumentClient.from(rawClient)

const tables: string[] = []

const gsi = (indexName: string, hashKey: string) => ({
  IndexName: indexName,
  KeySchema: [
    { AttributeName: hashKey, KeyType: 'HASH' as const },
    { AttributeName: 'createdAt', KeyType: 'RANGE' as const }
  ],
  Projection: { ProjectionType: 'ALL' as const }
})

/** Same schema as the IaC template (spec 002): `id` key and all the global indexes. */
export async function createFullTable(prefix: string): Promise<string> {
  const tableName = `${prefix}-${randomUUID()}`
  await rawClient.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'senderWalletAddress', AttributeType: 'S' },
        { AttributeName: 'receiverWalletAddress', AttributeType: 'S' },
        { AttributeName: 'entityType', AttributeType: 'S' },
        { AttributeName: 'userId', AttributeType: 'S' },
        { AttributeName: 'paymentId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' }
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        gsi('bySender', 'senderWalletAddress'),
        gsi('byReceiver', 'receiverWalletAddress'),
        gsi('byType', 'entityType'),
        gsi('byUser', 'userId'),
        gsi('byPayment', 'paymentId')
      ]
    })
  )
  tables.push(tableName)
  return tableName
}

export async function dropCreatedTables(): Promise<void> {
  await Promise.all(
    tables.map((TableName) => rawClient.send(new DeleteTableCommand({ TableName })))
  )
}
