import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js'

/**
 * Every spec that adds endpoints appends its routes here (caso 15).
 * Authentication runs before routing, so each one must answer 401 without
 * the API key even if the route does not exist yet.
 */
const PROTECTED_ROUTES: [
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string
][] = [
  ['get', '/api/v1/anything'],
  ['post', '/api/v1/anything'],
  ['delete', '/api/v1/anything']
]

const PUBLIC_ROUTES: [method: 'get', path: string][] = [['get', '/health']]

const app = buildTestApp()

describe('rutas protegidas', () => {
  it.each(PROTECTED_ROUTES)('%s %s sin API key → 401', async (method, path) => {
    const res = await request(app)[method](path)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it.each(PROTECTED_ROUTES)(
    '%s %s con API key llega al router (no 401)',
    async (method, path) => {
      const res = await request(app)[method](path).set('x-api-key', TEST_API_KEY)
      expect(res.status).not.toBe(401)
    }
  )

  it.each(PUBLIC_ROUTES)('%s %s es público', async (method, path) => {
    const res = await request(app)[method](path)
    expect(res.status).toBe(200)
  })

  it('el middleware de CORS no deja pasar sin API key una petición no preflight', async () => {
    const corsApp = buildTestApp([], { corsAllowedOrigins: ['https://app.example'] })
    const res = await request(corsApp)
      .post('/api/v1/anything')
      .set('origin', 'https://app.example')
    expect(res.status).toBe(401)
  })
})
