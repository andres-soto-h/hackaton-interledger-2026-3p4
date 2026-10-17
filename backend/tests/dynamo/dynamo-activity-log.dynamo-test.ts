import { GetItemCommand } from '@aws-sdk/client-dynamodb'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { afterAll, describe, expect, it } from 'vitest'
import { createDynamoActivityLog } from '../../src/shared/activity/dynamo-activity-log.js'
import { runActivityLogContract } from '../contract/activity-log.contract.js'
import {
  createFullTable,
  documentClient,
  dropCreatedTables,
  rawClient
} from '../helpers/dynamo-table.js'

afterAll(dropCreatedTables)

const START = Date.UTC(2026, 9, 17, 12, 0, 0)

runActivityLogContract('DynamoDB Local', async () => {
  let nowMs = START
  const log = createDynamoActivityLog({
    client: documentClient,
    tableName: await createFullTable('activity-test'),
    now: () => nowMs
  })
  return {
    log,
    advance: (ms) => {
      nowMs += ms
    },
    nowMs: () => nowMs
  }
})

describe('DynamoDB: detalles de almacenamiento del ActivityLog', () => {
  it('guarda entityType "event", expiresAt numérico y los datos ya filtrados', async () => {
    const tableName = await createFullTable('activity-test')
    const log = createDynamoActivityLog({
      client: documentClient,
      tableName,
      now: () => START
    })
    const event = await log.record({
      type: 'payment.quoted',
      paymentId: 'pay_1',
      message: 'Quote',
      data: { debitAmount: '1 USD', accessToken: 'tok-secret' }
    })

    const { Item } = await rawClient.send(
      new GetItemCommand({ TableName: tableName, Key: { id: { S: event.id } } })
    )
    expect(Item?.entityType).toEqual({ S: 'event' })
    expect(Item?.paymentId).toEqual({ S: 'pay_1' })
    expect(Item?.expiresAt).toEqual({ N: String(event.expiresAt) })
    expect(JSON.stringify(Item)).not.toContain('tok-secret')
  })

  it('un evento sin pago no escribe el atributo paymentId (no entra al índice byPayment)', async () => {
    const tableName = await createFullTable('activity-test')
    const log = createDynamoActivityLog({
      client: documentClient,
      tableName,
      now: () => START
    })
    const event = await log.record({ type: 'settings.updated', message: 'm' })
    const { Item } = await rawClient.send(
      new GetItemCommand({ TableName: tableName, Key: { id: { S: event.id } } })
    )
    expect(Item?.paymentId).toBeUndefined()
  })

  it('no mezcla otras entidades de la tabla (pagos, configuración) en la lista', async () => {
    const tableName = await createFullTable('activity-test')
    const log = createDynamoActivityLog({
      client: documentClient,
      tableName,
      now: () => START
    })
    await log.record({ type: 'payment.quoted', message: 'a' })
    await documentClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          id: 'settings',
          entityType: 'settings',
          createdAt: new Date(START).toISOString(),
          version: 1
        }
      })
    )
    const { items } = await log.list({})
    expect(items.map((e) => e.message)).toEqual(['a'])
  })
})
