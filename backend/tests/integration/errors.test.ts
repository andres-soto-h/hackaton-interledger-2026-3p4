import { Router } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/shared/errors/app-error.js'
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js'

// Routes that only exist in these tests, to exercise the error handling.
const failingRoutes = Router()
failingRoutes.get('/test/unhandled', () => {
  throw new Error('db password=hunter2')
})
failingRoutes.get('/test/unhandled-async', async () => {
  await Promise.resolve()
  throw new Error('db password=hunter2')
})
failingRoutes.get('/test/app-error', () => {
  throw new AppError(409, 'PAYMENT_ALREADY_EXISTS', 'Payment already exists')
})
failingRoutes.post('/test/echo', (req, res) => {
  res.json(req.body)
})

const app = buildTestApp([failingRoutes])

describe('manejo de errores', () => {
  // Caso 2
  it('responde 404 NOT_FOUND para una ruta inexistente', async () => {
    const res = await request(app).get('/no-existe').set('x-api-key', TEST_API_KEY)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' }
    })
  })

  // Caso 3
  it.each(['/test/unhandled', '/test/unhandled-async'])(
    'responde 500 INTERNAL_ERROR sin exponer detalles (%s)',
    async (path) => {
      const res = await request(app).get(path).set('x-api-key', TEST_API_KEY)

      expect(res.status).toBe(500)
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      })
      expect(res.text).not.toContain('hunter2')
      expect(res.text).not.toContain('stack')
    }
  )

  // Caso 4
  it('responde con el status y code de un AppError', async () => {
    const res = await request(app).get('/test/app-error').set('x-api-key', TEST_API_KEY)

    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      error: { code: 'PAYMENT_ALREADY_EXISTS', message: 'Payment already exists' }
    })
  })

  // Caso 5
  it('responde 400 INVALID_JSON con un body mal formado', async () => {
    const res = await request(app)
      .post('/test/echo')
      .set('x-api-key', TEST_API_KEY)
      .set('content-type', 'application/json')
      .send('{"amount": ')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'Malformed JSON body' }
    })
  })

  it('acepta un body JSON válido', async () => {
    const res = await request(app)
      .post('/test/echo')
      .set('x-api-key', TEST_API_KEY)
      .send({ amount: '10' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ amount: '10' })
  })
})
