import { Router } from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js'

const handler = vi.fn()
const protectedRoutes = Router()
protectedRoutes.get('/api/v1/protected', (_req, res) => {
  handler()
  res.json({ ok: true })
})

const app = buildTestApp([protectedRoutes])

describe('API key en la app', () => {
  it.each([
    ['sin x-api-key', undefined],
    ['con x-api-key incorrecta', 'wrong']
  ])('responde 401 %s sin ejecutar el handler', async (_name, apiKey) => {
    handler.mockClear()
    const req = request(app).get('/api/v1/protected')
    const res = await (apiKey === undefined ? req : req.set('x-api-key', apiKey))

    expect(res.status).toBe(401)
    expect(res.body).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('ejecuta el handler con la x-api-key correcta', async () => {
    handler.mockClear()
    const res = await request(app).get('/api/v1/protected').set('x-api-key', TEST_API_KEY)

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('valida la API key antes de leer el body', async () => {
    const res = await request(app)
      .post('/api/v1/protected')
      .set('content-type', 'application/json')
      .send('{bad json')

    expect(res.status).toBe(401)
  })
})
