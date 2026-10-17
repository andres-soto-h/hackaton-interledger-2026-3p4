import { Router } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validate } from '../../src/shared/middlewares/validate.js'
import { errorOf } from '../helpers/errors.js'
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js'

const routes = Router()
routes.post('/api/v1/echo', (req, res) => {
  res.json({ body: (req.body as unknown) ?? null })
})
routes.post(
  '/api/v1/items/:id',
  validate({
    params: z.strictObject({ id: z.string().regex(/^[a-z0-9]+$/) }),
    query: z.strictObject({ dryRun: z.enum(['true', 'false']).optional() }),
    body: z.strictObject({
      name: z.string().min(1),
      amount: z.strictObject({ value: z.string(), assetCode: z.string().length(3) })
    })
  }),
  (req, res) => {
    res.status(201).json({ ok: true, body: req.body as unknown })
  }
)
const app = buildTestApp([routes])
const post = (path: string) => request(app).post(path).set('x-api-key', TEST_API_KEY)

// Casos 7 y 8
describe('jsonBody', () => {
  it('rechaza un body de 17 kb con 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await post('/api/v1/echo').send({ blob: 'a'.repeat(17 * 1024) })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) as string }
    })
  })

  it('acepta un body menor al límite', async () => {
    const res = await post('/api/v1/echo').send({ blob: 'a'.repeat(1024) })
    expect(res.status).toBe(200)
  })

  it('rechaza text/plain con 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await post('/api/v1/echo').set('content-type', 'text/plain').send('hello')
    expect(res.status).toBe(415)
    expect(res.body).toEqual({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.any(String) as string }
    })
  })

  it('un POST sin body llega al handler', async () => {
    const res = await post('/api/v1/echo')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ body: null })
  })

  it('sigue respondiendo 400 INVALID_JSON con JSON malformado', async () => {
    const res = await post('/api/v1/echo')
      .set('content-type', 'application/json')
      .send('{bad')
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('INVALID_JSON')
  })
})

const valid = { name: 'coffee', amount: { value: '10.50', assetCode: 'USD' } }

// Caso 9
describe('validate', () => {
  it('deja pasar un body válido', async () => {
    const res = await post('/api/v1/items/abc1?dryRun=true').send(valid)
    expect(res.status).toBe(201)
    expect((res.body as { body: unknown }).body).toEqual(valid)
  })

  it('rechaza un campo desconocido con la ruta del error', async () => {
    const res = await post('/api/v1/items/abc1').send({ ...valid, extra: 1 })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
    expect(errorOf(res).details).toEqual(
      expect.arrayContaining([{ path: 'extra', message: expect.any(String) as string }])
    )
  })

  it('rechaza un tipo incorrecto con la ruta anidada', async () => {
    const res = await post('/api/v1/items/abc1').send({
      ...valid,
      amount: { value: 10.5, assetCode: 'USD' }
    })
    expect(res.status).toBe(400)
    expect(errorOf(res).details).toEqual([
      { path: 'amount.value', message: expect.any(String) as string }
    ])
  })

  it('valida query y params', async () => {
    const badQuery = await post('/api/v1/items/abc1?dryRun=maybe').send(valid)
    expect(errorOf(badQuery).details?.[0]?.path).toBe('dryRun')
    const badParam = await post('/api/v1/items/ABC!').send(valid)
    expect(badParam.status).toBe(400)
    expect(errorOf(badParam).details?.[0]?.path).toBe('id')
  })

  it('no expone el detalle interno de Zod en el mensaje', async () => {
    const res = await post('/api/v1/items/abc1').send({})
    expect(res.status).toBe(400)
    expect(errorOf(res).message).toBe('Invalid request')
  })
})
