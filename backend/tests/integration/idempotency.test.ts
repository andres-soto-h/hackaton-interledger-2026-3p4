import { Router } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryIdempotencyStore } from '../../src/shared/idempotency/in-memory-store.js'
import { idempotency } from '../../src/shared/middlewares/idempotency.js'
import { errorOf } from '../helpers/errors.js'
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js'

const KEY = 'order-0001-abcdef'

let calls = 0
let responder: () =>
  { status: number; body: unknown } | Promise<{ status: number; body: unknown }>

const makeApp = () => {
  const routes = Router()
  routes.post(
    '/api/v1/pay',
    idempotency(createInMemoryIdempotencyStore()),
    async (_req, res) => {
      calls += 1
      const { status, body } = await responder()
      res.status(status).json(body)
    }
  )
  return buildTestApp([routes])
}

let app: ReturnType<typeof makeApp>
/** `key = null` sends the request without an Idempotency-Key header. */
const pay = (body: unknown, key: string | null = KEY) => {
  const req = request(app).post('/api/v1/pay').set('x-api-key', TEST_API_KEY)
  return (key === null ? req : req.set('idempotency-key', key)).send(body as object)
}

beforeEach(() => {
  calls = 0
  responder = () => ({ status: 201, body: { id: `pay_${calls}` } })
  app = makeApp()
})

// Caso 11
describe('idempotency · repetición', () => {
  it('con la misma key y body ejecuta el handler una vez y devuelve la misma respuesta', async () => {
    const first = await pay({ amount: '10' })
    const second = await pay({ amount: '10' })
    expect(calls).toBe(1)
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
  })

  it('sin Idempotency-Key ejecuta el handler cada vez', async () => {
    await pay({ amount: '10' }, null)
    await pay({ amount: '10' }, null)
    expect(calls).toBe(2)
  })

  it('keys distintas son independientes', async () => {
    await pay({ amount: '10' }, 'key-aaaaaaaa')
    await pay({ amount: '10' }, 'key-bbbbbbbb')
    expect(calls).toBe(2)
  })

  it('también repite las respuestas 4xx', async () => {
    responder = () => ({ status: 422, body: { error: { code: 'X', message: 'x' } } })
    await pay({ amount: '10' })
    const second = await pay({ amount: '10' })
    expect(calls).toBe(1)
    expect(second.status).toBe(422)
  })

  it.each(['short', 'has space in key', 'a'.repeat(65), 'bad/key/chars'])(
    'rechaza el formato de key inválido %j con 400 VALIDATION_ERROR',
    async (key) => {
      const res = await pay({ amount: '10' }, key)
      expect(res.status).toBe(400)
      expect(errorOf(res).code).toBe('VALIDATION_ERROR')
      expect(calls).toBe(0)
    }
  )
})

// Caso 12
describe('idempotency · otro body', () => {
  it('responde 409 IDEMPOTENCY_CONFLICT sin ejecutar el handler', async () => {
    await pay({ amount: '10' })
    const res = await pay({ amount: '99' })
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('IDEMPOTENCY_CONFLICT')
    expect(calls).toBe(1)
  })
})

// Caso 13
describe('idempotency · en curso', () => {
  it('una segunda petición con la misma key mientras la primera sigue responde 409', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    responder = async () => {
      await gate
      return { status: 201, body: { id: 'pay_1' } }
    }

    const first = pay({ amount: '10' }).then((r) => r)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const second = await pay({ amount: '10' })
    expect(second.status).toBe(409)
    expect(errorOf(second).code).toBe('IDEMPOTENCY_CONFLICT')

    release()
    const done = await first
    expect(done.status).toBe(201)
    expect(calls).toBe(1)
  })
})

// Caso 14
describe('idempotency · 5xx', () => {
  it('tras una respuesta 5xx el reintento con la misma key ejecuta el handler de nuevo', async () => {
    responder = () => ({
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'x' } }
    })
    const first = await pay({ amount: '10' })
    expect(first.status).toBe(500)

    responder = () => ({ status: 201, body: { id: 'pay_ok' } })
    const second = await pay({ amount: '10' })
    expect(second.status).toBe(201)
    expect(calls).toBe(2)
  })

  it('si el handler lanza un error, la key queda libre', async () => {
    responder = () => {
      throw new Error('boom')
    }
    const first = await pay({ amount: '10' })
    expect(first.status).toBe(500)
    responder = () => ({ status: 201, body: { id: 'pay_ok' } })
    const second = await pay({ amount: '10' })
    expect(second.status).toBe(201)
  })
})
