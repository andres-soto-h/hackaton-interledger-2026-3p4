import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createDevPasskeyPageRouter } from '../../src/modules/dev/dev-passkey-page.routes.js'
import { buildTestApp } from '../helpers/app.js'

// Tarea 8 / caso 16: página mínima para probar passkeys en local (el cableado solo en server.ts).
describe('página de prueba de passkeys (solo local)', () => {
  const app = buildTestApp([createDevPasskeyPageRouter()])

  it('GET /dev/passkeys responde HTML sin API key y carga su script desde el mismo origen', async () => {
    const res = await request(app).get('/dev/passkeys')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('<script src="/dev/passkeys.js"')
    // helmet's default CSP forbids inline scripts: there must be none.
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
  })

  it('GET /dev/passkeys.js usa WebAuthn y los endpoints de auth', async () => {
    const res = await request(app).get('/dev/passkeys.js')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/javascript/)
    for (const needle of [
      'navigator.credentials.create',
      'navigator.credentials.get',
      '/api/v1/auth/register/options',
      '/api/v1/auth/register/verify',
      '/api/v1/auth/login/options',
      '/api/v1/auth/login/verify',
      '/api/v1/me'
    ]) {
      expect(res.text).toContain(needle)
    }
  })

  it('las demás rutas siguen exigiendo la API key', async () => {
    const res = await request(app).get('/dev/other')
    expect(res.status).toBe(401)
  })
})
