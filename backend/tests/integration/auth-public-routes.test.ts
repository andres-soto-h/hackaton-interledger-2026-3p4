import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { errorOf } from '../helpers/errors.js'
import { buildAuthContext, type AuthContext } from '../helpers/auth-context.js'

let ctx: AuthContext
beforeEach(() => {
  ctx = buildAuthContext()
})

// Tarea 7: ajuste de las rutas públicas del spec 001.
describe('rutas de cuentas y la API key', () => {
  it.each([
    ['post', '/api/v1/auth/register/options'],
    ['post', '/api/v1/auth/register/verify'],
    ['post', '/api/v1/auth/login/options'],
    ['post', '/api/v1/auth/login/verify']
  ] as const)('%s %s llega al router sin x-api-key', async (method, path) => {
    const res = await request(ctx.app)[method](path).send({})
    expect(errorOf(res).code).not.toBe('UNAUTHORIZED')
  })

  it.each([['get'], ['delete']] as const)(
    '%s /api/v1/me sin x-api-key responde SESSION_INVALID (usa userAuth, no la API key)',
    async (method) => {
      const res = await request(ctx.app)[method]('/api/v1/me')
      expect(res.status).toBe(401)
      expect(errorOf(res).code).toBe('SESSION_INVALID')
    }
  )

  it.each([
    ['post', '/api/v1/me'],
    ['put', '/api/v1/me'],
    ['get', '/api/v1/auth/login/options'],
    ['post', '/api/v1/auth/other'],
    ['post', '/api/v1/auth/register/options/extra']
  ] as const)('%s %s sigue exigiendo la API key', async (method, path) => {
    const res = await request(ctx.app)[method](path)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('UNAUTHORIZED')
  })

  it('el callback de Open Payments sigue siendo público (GET)', async () => {
    const res = await request(ctx.app).get('/api/v1/auth/callback?interact_ref=x&hash=y')
    expect(errorOf(res).code).not.toBe('UNAUTHORIZED')
  })
})
