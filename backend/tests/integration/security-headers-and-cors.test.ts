import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/app.js'

// Caso 4
describe('securityHeaders', () => {
  it('incluye las cabeceras de helmet y no x-powered-by', async () => {
    const res = await request(buildTestApp()).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['strict-transport-security']).toBeDefined()
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('también en respuestas de error', async () => {
    const res = await request(buildTestApp()).get('/api/v1/nope')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})

const preflight = (app: ReturnType<typeof buildTestApp>, origin: string) =>
  request(app)
    .options('/api/v1/payments')
    .set('origin', origin)
    .set('access-control-request-method', 'POST')

// Casos 5 y 6
describe('cors', () => {
  it('con la lista vacía no agrega cabeceras CORS', async () => {
    const res = await preflight(buildTestApp(), 'https://app.example')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    const get = await request(buildTestApp())
      .get('/health')
      .set('origin', 'https://app.example')
    expect(get.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('con lista, el origen permitido recibe las cabeceras CORS (también en el preflight sin API key)', async () => {
    const app = buildTestApp([], { corsAllowedOrigins: ['https://app.example'] })
    const res = await preflight(app, 'https://app.example')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example')
    const get = await request(app).get('/health').set('origin', 'https://app.example')
    expect(get.headers['access-control-allow-origin']).toBe('https://app.example')
  })

  it('con lista, un origen no permitido no recibe cabeceras CORS', async () => {
    const app = buildTestApp([], { corsAllowedOrigins: ['https://app.example'] })
    const res = await preflight(app, 'https://evil.example')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    const get = await request(app)
      .get('/health')
      .set('origin', 'https://app.example.evil.test')
    expect(get.headers['access-control-allow-origin']).toBeUndefined()
  })
})
