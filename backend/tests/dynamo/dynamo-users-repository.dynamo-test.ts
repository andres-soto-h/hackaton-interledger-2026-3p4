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
import { createDynamoUsersRepository } from '../../src/modules/users/dynamo-users.repository.js'
import {
  buildChallenge,
  buildCredential,
  buildUser,
  runUsersRepositoryContract
} from '../contract/users-repository.contract.js'

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
  const tableName = `users-test-${randomUUID()}`
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

runUsersRepositoryContract('DynamoDB Local', async () =>
  createDynamoUsersRepository({ client: documentClient, tableName: await createTable() })
)

const count = async (tableName: string): Promise<number> =>
  (await client.send(new ScanCommand({ TableName: tableName, Select: 'COUNT' }))).Count ??
  0

describe('DynamoDB: detalles de almacenamiento', () => {
  it('guarda el TTL del challenge como número (segundos epoch) en expiresAt', async () => {
    const tableName = await createTable()
    const repo = createDynamoUsersRepository({ client: documentClient, tableName })
    const challenge = buildChallenge()

    await repo.createChallenge(challenge)

    const { Item } = await client.send(
      new GetItemCommand({ TableName: tableName, Key: { id: { S: challenge.id } } })
    )
    expect(Item?.expiresAt).toEqual({ N: String(challenge.expiresAt) })
  })

  it('consumir un challenge lo borra de la tabla', async () => {
    const tableName = await createTable()
    const repo = createDynamoUsersRepository({ client: documentClient, tableName })
    await repo.createChallenge(buildChallenge())

    await repo.consumeChallenge(buildChallenge().id, 1)

    expect(await count(tableName)).toBe(0)
  })

  it('borrar un usuario deja la tabla vacía (usuario, credenciales y unicidad de la wallet)', async () => {
    const tableName = await createTable()
    const repo = createDynamoUsersRepository({ client: documentClient, tableName })
    await repo.createUserWithCredential(buildUser(), buildCredential())
    await repo
      .createUserWithCredential(buildUser(), buildCredential({ id: 'cred-alice-2' }))
      .catch(() => undefined)

    await repo.deleteUserAndCredentials(buildUser().id)

    expect(await count(tableName)).toBe(0)
  })

  it('lista las credenciales de un usuario con el índice byUser', async () => {
    const tableName = await createTable()
    const repo = createDynamoUsersRepository({ client: documentClient, tableName })
    await repo.createUserWithCredential(buildUser(), buildCredential())

    expect(await repo.listCredentials(buildUser().id)).toEqual([buildCredential()])
    expect(await repo.listCredentials('usr_other')).toEqual([])
  })
})
