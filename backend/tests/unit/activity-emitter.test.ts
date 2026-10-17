import { describe, expect, it, vi } from 'vitest'
import { createActivityEmitter } from '../../src/shared/activity/activity-emitter.js'
import type { ActivityLog } from '../../src/shared/activity/activity-log.js'
import { createInMemoryActivityLog } from '../../src/shared/activity/in-memory-activity-log.js'
import { currentRequestId, runWithRequestId } from '../../src/shared/request-context.js'

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)

describe('request-context', () => {
  it('expone el requestId dentro de runWithRequestId, también tras un await', async () => {
    expect(currentRequestId()).toBeUndefined()
    const seen = await runWithRequestId('req-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return currentRequestId()
    })
    expect(seen).toBe('req-1')
    expect(currentRequestId()).toBeUndefined()
  })
})

// Caso 3 (spec 022): los eventos no contienen secretos.
describe('activity emitter · contenido', () => {
  it('guarda solo los campos permitidos y descarta tokens, nonces, interact_ref y hash', async () => {
    const log = createInMemoryActivityLog({ now: () => NOW })
    const emit = createActivityEmitter({ log })
    await emit({
      type: 'wallet_link.callback_invalid',
      level: 'warn',
      message: 'Callback inválido',
      data: {
        reason: 'hash_mismatch',
        hash: 'SECRET-HASH',
        interact_ref: 'SECRET-REF',
        accessToken: 'SECRET-TOKEN',
        clientNonce: 'SECRET-NONCE',
        apiKey: 'SECRET-KEY',
        unknownField: 'dropped'
      }
    })
    const [event] = (await log.list()).items
    expect(event?.data).toEqual({ reason: 'hash_mismatch' })
    expect(JSON.stringify(event)).not.toMatch(/SECRET/)
  })

  it('agrega el requestId del contexto cuando el evento no trae uno', async () => {
    const log = createInMemoryActivityLog({ now: () => NOW })
    const emit = createActivityEmitter({ log })
    await runWithRequestId('req-ctx-1', () =>
      emit({ type: 'user.registered', message: 'Usuario registrado' })
    )
    await emit({ type: 'user.registered', message: 'Sin contexto' })
    await runWithRequestId('req-ctx-2', () =>
      emit({ type: 'user.registered', message: 'Explícito', requestId: 'req-explicit' })
    )
    const items = (await log.list()).items
    expect(items.map((e) => e.requestId)).toEqual([
      'req-ctx-1',
      undefined,
      'req-explicit'
    ])
  })

  it('sin ActivityLog es un no-op', async () => {
    const emit = createActivityEmitter({})
    await expect(emit({ type: 'user.registered', message: 'x' })).resolves.toBeUndefined()
  })
})

// Caso 4 (spec 022): el registro de actividad nunca rompe un pago.
describe('activity emitter · fallos', () => {
  it('si record lanza, no propaga el error y avisa en el log técnico', async () => {
    const log: ActivityLog = {
      record: () => Promise.reject(new Error('dynamo down')),
      list: () => Promise.resolve({ items: [] })
    }
    const logger = { warn: vi.fn() }
    const emit = createActivityEmitter({ log, logger })
    await expect(
      emit({ type: 'payment.quoted', message: 'Quote' })
    ).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('si record tarda más que el timeout, no bloquea y avisa en el log técnico', async () => {
    const log: ActivityLog = {
      record: () => new Promise(() => undefined),
      list: () => Promise.resolve({ items: [] })
    }
    const logger = { warn: vi.fn() }
    const emit = createActivityEmitter({ log, logger, timeoutMs: 20 })
    const started = Date.now()
    await emit({ type: 'payment.quoted', message: 'Quote' })
    expect(Date.now() - started).toBeLessThan(500)
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('el aviso técnico no incluye los datos del evento', async () => {
    const log: ActivityLog = {
      record: () => Promise.reject(new Error('boom')),
      list: () => Promise.resolve({ items: [] })
    }
    const logger = { warn: vi.fn() }
    const emit = createActivityEmitter({ log, logger })
    await emit({
      type: 'payment.quoted',
      message: 'Quote',
      data: { amount: '10.00', accessToken: 'SECRET-TOKEN' }
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('SECRET-TOKEN')
  })
})
