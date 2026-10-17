import { GetItemCommand } from '@aws-sdk/client-dynamodb'
import { afterAll, describe, expect, it } from 'vitest'
import { createDynamoIdempotencyStore } from '../../src/shared/idempotency/dynamo-store.js'
import {
  createFullTable,
  documentClient,
  dropCreatedTables,
  rawClient
} from '../helpers/dynamo-table.js'

afterAll(dropCreatedTables)

const TTL = 86_400

const build = async (now: () => number = () => 1_000_000_000_000) => {
  const tableName = await createFullTable('idem-test')
  return {
    tableName,
    store: createDynamoIdempotencyStore({ client: documentClient, tableName, now })
  }
}

// Same behaviour as the in-memory store (tests/unit/in-memory-idempotency-store.test.ts).
describe('DynamoIdempotencyStore', () => {
  it('la primera llamada es nueva y la repetida mientras está en curso es in_progress', async () => {
    const { store } = await build()
    expect(await store.begin('idem_k1', 'h1', TTL)).toEqual({ kind: 'new' })
    expect(await store.begin('idem_k1', 'h1', TTL)).toEqual({ kind: 'in_progress' })
    expect(await store.begin('idem_k1', 'other', TTL)).toEqual({ kind: 'in_progress' })
  })

  it('tras complete devuelve replay con la respuesta guardada', async () => {
    const { store } = await build()
    await store.begin('idem_k1', 'h1', TTL)
    await store.complete('idem_k1', 201, { id: 'pay_1', nested: { ok: true } })
    expect(await store.begin('idem_k1', 'h1', TTL)).toEqual({
      kind: 'replay',
      status: 201,
      body: { id: 'pay_1', nested: { ok: true } }
    })
  })

  it('con otro hash de body devuelve mismatch', async () => {
    const { store } = await build()
    await store.begin('idem_k1', 'h1', TTL)
    await store.complete('idem_k1', 201, {})
    expect(await store.begin('idem_k1', 'h2', TTL)).toEqual({ kind: 'mismatch' })
  })

  it('release permite volver a empezar y las keys son independientes', async () => {
    const { store } = await build()
    await store.begin('idem_k1', 'h1', TTL)
    expect(await store.begin('idem_k2', 'h1', TTL)).toEqual({ kind: 'new' })
    await store.release('idem_k1')
    expect(await store.begin('idem_k1', 'h1', TTL)).toEqual({ kind: 'new' })
  })

  it('el registro vencido se reemplaza aunque DynamoDB aún no lo haya borrado', async () => {
    let now = 1_000_000_000_000
    const { store } = await build(() => now)
    await store.begin('idem_k1', 'h1', 10)
    await store.complete('idem_k1', 200, { a: 1 })
    now += 9_000
    expect((await store.begin('idem_k1', 'h1', 10)).kind).toBe('replay')
    now += 2_000
    expect(await store.begin('idem_k1', 'h1', 10)).toEqual({ kind: 'new' })
  })

  it('dos begin en paralelo con la misma key: solo uno es new', async () => {
    const { store } = await build()
    const results = await Promise.all([
      store.begin('idem_k1', 'h1', TTL),
      store.begin('idem_k1', 'h1', TTL),
      store.begin('idem_k1', 'h1', TTL)
    ])
    expect(results.filter((r) => r.kind === 'new')).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'in_progress')).toHaveLength(2)
  })

  it('guarda el TTL en segundos epoch en expiresAt y complete no lo cambia', async () => {
    const { store, tableName } = await build(() => 1_000_000_000_000)
    await store.begin('idem_k1', 'h1', TTL)
    await store.complete('idem_k1', 200, {})
    const { Item } = await rawClient.send(
      new GetItemCommand({ TableName: tableName, Key: { id: { S: 'idem_k1' } } })
    )
    expect(Item?.expiresAt).toEqual({ N: String(1_000_000_000 + TTL) })
    expect(Item?.entityType).toEqual({ S: 'idempotency' })
  })

  it('complete sobre una key inexistente no crea el registro', async () => {
    const { store } = await build()
    await store.complete('idem_missing', 200, {})
    expect(await store.begin('idem_missing', 'h1', TTL)).toEqual({ kind: 'new' })
  })
})
