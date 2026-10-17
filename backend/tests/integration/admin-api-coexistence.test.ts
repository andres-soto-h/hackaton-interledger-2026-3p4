import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildAdminHarness, call, ORIGIN, ADMIN_PASSWORD } from '../helpers/admin.js'
import { TEST_API_KEY } from '../helpers/app.js'

// El panel comparte app con la API JSON: las reglas de cada lado no se pisan.
describe('panel y API en la misma app', () => {
  it('el formulario de login (urlencoded) no recibe 415 del parser JSON de la API', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'post', '/admin/login')
      .type('form')
      .set('origin', ORIGIN)
      .send({ password: ADMIN_PASSWORD })
    expect(res.status).not.toBe(415)
  })

  it('la API sigue rechazando un POST que no es JSON con 415', async () => {
    const h = buildAdminHarness()
    const res = await request(h.app)
      .post('/api/v1/anything')
      .set('x-api-key', TEST_API_KEY)
      .set('content-type', 'text/plain')
      .send('hello')
    expect(res.status).toBe(415)
  })

  it('la API key del resto de la API no abre el panel', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', '/admin').set('x-api-key', TEST_API_KEY)
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
  })

  it('el panel no queda expuesto por un prefijo parecido (/administrator sigue exigiendo la API key)', async () => {
    const h = buildAdminHarness()
    expect((await request(h.app).get('/administrator')).status).toBe(401)
  })
})
