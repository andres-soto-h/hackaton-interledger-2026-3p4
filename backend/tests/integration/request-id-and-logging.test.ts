import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js'
import { captureLogs } from '../helpers/log-capture.js'

const UUID = '3f1c2b4e-8a5d-4c1e-9b7a-0d6f5e4c3b2a'
const ULID = '01J9Z8X7Q6W5E4R3T2Y1U0I9O8'

// Caso 1
describe('requestId', () => {
  it('genera un id cuando la petición no trae x-request-id', async () => {
    const res = await request(buildTestApp()).get('/health')
    expect(res.headers['x-request-id']).toMatch(/^[0-9A-Za-z-]{20,}$/)
  })

  it.each([
    ['UUID', UUID],
    ['ULID', ULID]
  ])('reutiliza un x-request-id válido (%s)', async (_name, id) => {
    const res = await request(buildTestApp()).get('/health').set('x-request-id', id)
    expect(res.headers['x-request-id']).toBe(id)
  })

  it('reemplaza un x-request-id inválido', async () => {
    const res = await request(buildTestApp())
      .get('/health')
      .set('x-request-id', 'not valid!!')
    expect(res.headers['x-request-id']).not.toBe('not valid!!')
    expect(res.headers['x-request-id']).toMatch(/^[0-9A-Za-z-]{20,}$/)
  })

  it('también lo devuelve en respuestas de error', async () => {
    const res = await request(buildTestApp()).get('/api/v1/nope')
    expect(res.status).toBe(401)
    expect(res.headers['x-request-id']).toBeTruthy()
  })

  it('el id aparece en los logs de la petición', async () => {
    const { logger, text } = captureLogs()
    await request(buildTestApp([], { logger })).get('/health').set('x-request-id', UUID)
    expect(text()).toContain(UUID)
  })
})

// Casos 2 y 3
describe('httpLogger', () => {
  it('registra método, ruta, status y duración', async () => {
    const { logger, text } = captureLogs()
    await request(buildTestApp([], { logger })).get('/health')
    const line = JSON.parse(text().trim().split('\n').at(-1) ?? '{}') as Record<
      string,
      unknown
    >
    expect(JSON.stringify(line)).toContain('/health')
    expect(JSON.stringify(line)).toContain('200')
    expect(JSON.stringify(line)).toMatch(/responseTime|duration/)
  })

  it('redacta x-api-key, Authorization e Idempotency-Key', async () => {
    const { logger, text } = captureLogs()
    await request(buildTestApp([], { logger }))
      .get('/api/v1/anything')
      .set('x-api-key', 'SECRET-API-KEY-VALUE')
      .set('authorization', 'GNAP SECRET-TOKEN-VALUE')
      .set('idempotency-key', 'SECRET-IDEM-KEY-VALUE')
    const logs = text()
    expect(logs).not.toContain('SECRET-API-KEY-VALUE')
    expect(logs).not.toContain('SECRET-TOKEN-VALUE')
    expect(logs).not.toContain('SECRET-IDEM-KEY-VALUE')
    expect(logs).toContain('[REDACTED]')
  })

  it('no registra la API key correcta que llega en la petición', async () => {
    const { logger, text } = captureLogs()
    await request(buildTestApp([], { logger }))
      .get('/api/v1/anything')
      .set('x-api-key', TEST_API_KEY)
    expect(text()).not.toContain(TEST_API_KEY)
  })

  it('no registra interact_ref ni hash del callback', async () => {
    const { logger, text } = captureLogs()
    await request(buildTestApp([], { logger })).get(
      '/api/v1/auth/callback?interact_ref=SECRET-INTERACT-REF&hash=SECRET-HASH-VALUE'
    )
    const logs = text()
    expect(logs).not.toContain('SECRET-INTERACT-REF')
    expect(logs).not.toContain('SECRET-HASH-VALUE')
    expect(logs).toContain('/api/v1/auth/callback')
  })
})
