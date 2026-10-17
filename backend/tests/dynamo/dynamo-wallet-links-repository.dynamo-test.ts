import { randomUUID } from 'node:crypto'
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  GetItemCommand,
  ScanCommand
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { afterAll, describe, expect, it } from 'vitest'
import { createDynamoWalletLinksRepository } from '../../src/modules/wallet-links/dynamo-wallet-links.repository.js'
import {
  buildWalletLink,
  runWalletLinksRepositoryContract
} from '../contract/wallet-links-repository.contract.js'

// DynamoDB Local (see `pnpm test:dynamo`); fake credentials, never real AWS.
const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' }
})
const documentClient = DynamoDBDocumentClient.from(client)
const tables: string[] = []

/** Same schema as the IaC template (spec 002): `id` key and the byType and byUser indexes. */
async function createTable(): Promise<string> {
  const tableName = `wallet-links-test-${randomUUID()}`
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
        { AttributeName: 'entityType', AttributeType: 'S' },
        { AttributeName: 'userId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' }
      ],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [index('byType', 'entityType'), index('byUser', 'userId')]
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

runWalletLinksRepositoryContract('DynamoDB Local', async () =>
  createDynamoWalletLinksRepository({
    client: documentClient,
    tableName: await createTable()
  })
)

const PERIOD = '2026-10-17T05:00:00.000Z'
const LINK_ID = buildWalletLink().id

const count = async (tableName: string): Promise<number> =>
  (await client.send(new ScanCommand({ TableName: tableName, Select: 'COUNT' }))).Count ??
  0

describe('DynamoDB: detalles de almacenamiento de wallet links', () => {
  it('la vinculación se guarda con entityType y userId (índices byType y byUser)', async () => {
    const tableName = await createTable()
    const repo = createDynamoWalletLinksRepository({ client: documentClient, tableName })
    await repo.create(buildWalletLink())

    const { Item } = await client.send(
      new GetItemCommand({ TableName: tableName, Key: { id: { S: LINK_ID } } })
    )
    expect(Item?.entityType).toEqual({ S: 'walletLink' })
    expect(Item?.userId).toEqual({ S: 'usr_alice' })
  })

  it('el contador de gasto es un ítem aparte con `spent` numérico y TTL en segundos epoch', async () => {
    const tableName = await createTable()
    const repo = createDynamoWalletLinksRepository({ client: documentClient, tableName })
    await repo.create(buildWalletLink())

    await repo.reserve({
      linkId: LINK_ID,
      periodStart: PERIOD,
      amount: '5000',
      limit: '20000'
    })

    const { Item } = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: { id: { S: `spend#${LINK_ID}#${PERIOD}` } }
      })
    )
    expect(Item?.spent).toEqual({ N: '5000' })
    // Out of the indexes: a counter never shows up as a link of the user.
    expect(Item?.userId).toBeUndefined()
    expect(Item?.entityType).toBeUndefined()
    const ttl = Number(Item?.expiresAt?.N)
    expect(ttl).toBeGreaterThan(Date.parse(PERIOD) / 1000)
    expect(Number.isInteger(ttl)).toBe(true)
  })

  it('una reserva rechazada no crea el contador', async () => {
    const tableName = await createTable()
    const repo = createDynamoWalletLinksRepository({ client: documentClient, tableName })
    await repo.create(buildWalletLink())

    const result = await repo.reserve({
      linkId: LINK_ID,
      periodStart: PERIOD,
      amount: '20001',
      limit: '20000'
    })

    expect(result).toEqual({ ok: false, spent: '0' })
    expect(await count(tableName)).toBe(1) // solo la vinculación
  })

  it('los contadores no alteran la búsqueda por usuario', async () => {
    const tableName = await createTable()
    const repo = createDynamoWalletLinksRepository({ client: documentClient, tableName })
    await repo.create(buildWalletLink({ status: 'ACTIVE' }))
    await repo.reserve({
      linkId: LINK_ID,
      periodStart: PERIOD,
      amount: '100',
      limit: '20000'
    })

    expect((await repo.findLatestByUser('usr_alice'))?.id).toBe(LINK_ID)
    expect((await repo.findActiveByUser('usr_alice'))?.id).toBe(LINK_ID)
  })

  it('update con undefined borra el atributo en la tabla', async () => {
    const tableName = await createTable()
    const repo = createDynamoWalletLinksRepository({ client: documentClient, tableName })
    await repo.create(buildWalletLink({ tokenCiphertext: 'abc' }))

    await repo.update(LINK_ID, { tokenCiphertext: undefined })

    const { Item } = await client.send(
      new GetItemCommand({ TableName: tableName, Key: { id: { S: LINK_ID } } })
    )
    expect(Item?.tokenCiphertext).toBeUndefined()
  })
})
