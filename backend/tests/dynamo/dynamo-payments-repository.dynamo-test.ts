import { randomUUID } from 'node:crypto'
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  GetItemCommand
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { afterAll, describe, expect, it } from 'vitest'
import { createDynamoPaymentsRepository } from '../../src/modules/payments/dynamo-payments.repository.js'
import {
  buildPayment,
  runPaymentsRepositoryContract
} from '../contract/payments-repository.contract.js'

// DynamoDB Local (see `pnpm test:dynamo`); fake credentials, never real AWS.
const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
})
const documentClient = DynamoDBDocumentClient.from(client)
const tables: string[] = []

/** Same schema as the IaC template (spec 002): `id` key, bySender and byReceiver indexes. */
async function createTable(): Promise<string> {
  const tableName = `payments-test-${randomUUID()}`
  const index = (indexName: string, hashKey: string) => ({
    IndexName: indexName,
    KeySchema: [
      { AttributeName: hashKey, KeyType: 'HASH' as const },
      { AttributeName: 'createdAt', KeyType: 'RANGE' as const }
    ],
    Projection: { ProjectionType: 'ALL' as const }
  })
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'S' },
        { AttributeName: 'senderWalletAddress', AttributeType: 'S' },
        { AttributeName: 'receiverWalletAddress', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' }
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        index('bySender', 'senderWalletAddress'),
        index('byReceiver', 'receiverWalletAddress')
      ]
    })
  )
  tables.push(tableName)
  return tableName
}

afterAll(async () => {
  await Promise.all(
    tables.map((TableName) => client.send(new DeleteTableCommand({ TableName })))
  )
})

runPaymentsRepositoryContract('DynamoDB Local', async () =>
  createDynamoPaymentsRepository({
    client: documentClient,
    tableName: await createTable()
  })
)

describe('DynamoDB: detalles de almacenamiento', () => {
  it('guarda expiresAt como número (TTL en segundos epoch)', async () => {
    const tableName = await createTable()
    const repo = createDynamoPaymentsRepository({ client: documentClient, tableName })
    const payment = buildPayment()

    await repo.createPayment(payment)

    const { Item } = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: { id: { S: payment.id } }
      })
    )
    expect(Item?.expiresAt).toEqual({ N: String(payment.expiresAt) })
  })
})
