import { GetItemCommand } from '@aws-sdk/client-dynamodb'
import { afterAll, describe, expect, it } from 'vitest'
import { createDynamoSettingsStore } from '../../src/shared/settings/dynamo-settings-store.js'
import { runSettingsStoreContract } from '../contract/settings-store.contract.js'
import {
  createFullTable,
  documentClient,
  dropCreatedTables,
  rawClient
} from '../helpers/dynamo-table.js'

afterAll(dropCreatedTables)

runSettingsStoreContract('DynamoDB Local', async () =>
  createDynamoSettingsStore({
    client: documentClient,
    tableName: await createFullTable('settings-test')
  })
)

describe('DynamoDB: detalles de almacenamiento de la configuración', () => {
  it('es un solo registro con id "settings", entityType "settings" y versión numérica', async () => {
    const tableName = await createFullTable('settings-test')
    const store = createDynamoSettingsStore({ client: documentClient, tableName })
    await store.save({ feePercentage: '1.5', allowedWalletHosts: ['a.test'] }, 0)
    await store.save({ feePercentage: '2' }, 1)

    const { Item } = await rawClient.send(
      new GetItemCommand({ TableName: tableName, Key: { id: { S: 'settings' } } })
    )
    expect(Item?.entityType).toEqual({ S: 'settings' })
    expect(Item?.version).toEqual({ N: '2' })
  })

  it('el segundo guardado con la misma versión falla aunque el primero sea reciente', async () => {
    const store = createDynamoSettingsStore({
      client: documentClient,
      tableName: await createFullTable('settings-test')
    })
    await store.save({ feePercentage: '1' }, 0)
    const [a, b] = await Promise.allSettled([
      store.save({ feePercentage: '2' }, 1),
      store.save({ feePercentage: '3' }, 1)
    ])
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
  })
})
