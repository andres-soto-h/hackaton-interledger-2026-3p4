import { describe, expect, it } from 'vitest'
import { createInMemoryIdempotencyStore } from '../../src/shared/idempotency/in-memory-store.js'

const TTL = 86_400

describe('InMemoryIdempotencyStore', () => {
  it('la primera llamada es nueva y la repetida mientras está en curso es in_progress', async () => {
    const store = createInMemoryIdempotencyStore()
    expect(await store.begin('k1', 'h1', TTL)).toEqual({ kind: 'new' })
    expect(await store.begin('k1', 'h1', TTL)).toEqual({ kind: 'in_progress' })
    expect(await store.begin('k1', 'other', TTL)).toEqual({ kind: 'in_progress' })
  })

  it('tras complete devuelve replay con la respuesta guardada', async () => {
    const store = createInMemoryIdempotencyStore()
    await store.begin('k1', 'h1', TTL)
    await store.complete('k1', 201, { id: 'pay_1' })
    expect(await store.begin('k1', 'h1', TTL)).toEqual({
      kind: 'replay',
      status: 201,
      body: { id: 'pay_1' }
    })
  })

  it('con otro hash de body devuelve mismatch', async () => {
    const store = createInMemoryIdempotencyStore()
    await store.begin('k1', 'h1', TTL)
    await store.complete('k1', 201, {})
    expect(await store.begin('k1', 'h2', TTL)).toEqual({ kind: 'mismatch' })
  })

  it('release permite volver a empezar', async () => {
    const store = createInMemoryIdempotencyStore()
    await store.begin('k1', 'h1', TTL)
    await store.release('k1')
    expect(await store.begin('k1', 'h1', TTL)).toEqual({ kind: 'new' })
  })

  it('las keys son independientes', async () => {
    const store = createInMemoryIdempotencyStore()
    await store.begin('k1', 'h1', TTL)
    expect(await store.begin('k2', 'h1', TTL)).toEqual({ kind: 'new' })
  })

  it('el registro expira tras el TTL', async () => {
    let now = 1_000_000
    const store = createInMemoryIdempotencyStore({ now: () => now })
    await store.begin('k1', 'h1', 10)
    await store.complete('k1', 200, { a: 1 })
    now += 9_000
    expect((await store.begin('k1', 'h1', 10)).kind).toBe('replay')
    now += 2_000
    expect(await store.begin('k1', 'h1', 10)).toEqual({ kind: 'new' })
  })
})
