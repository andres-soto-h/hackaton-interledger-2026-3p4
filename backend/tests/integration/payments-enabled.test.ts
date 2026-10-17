import { Router } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { requirePaymentsEnabled } from '../../src/shared/middlewares/payments-enabled.js'
import { createInMemorySettingsStore } from '../../src/shared/settings/in-memory-settings-store.js'
import { createStoreSettingsProvider } from '../../src/shared/settings/store-settings-provider.js'
import { buildTestApp, TEST_API_KEY } from '../helpers/app.js'
import { DEFAULT_SETTINGS } from '../helpers/admin.js'
import { errorOf } from '../helpers/errors.js'

const setup = () => {
  let nowMs = Date.UTC(2026, 9, 17, 12, 0, 0)
  const store = createInMemorySettingsStore()
  const settings = createStoreSettingsProvider({
    store,
    defaults: DEFAULT_SETTINGS,
    now: () => nowMs
  })
  let handled = 0
  const router = Router()
  router.post('/api/v1/payments', requirePaymentsEnabled(settings), (_req, res) => {
    handled += 1
    res.status(201).json({ ok: true })
  })
  router.post(
    '/api/v1/payment-requests',
    requirePaymentsEnabled(settings),
    (_req, res) => {
      handled += 1
      res.status(201).json({ ok: true })
    }
  )
  router.get('/api/v1/payments', (_req, res) => {
    res.json({ items: [] })
  })
  return {
    app: buildTestApp([router]),
    store,
    handled: () => handled,
    advance: (ms: number) => {
      nowMs += ms
    }
  }
}
const post = (app: ReturnType<typeof setup>['app'], path: string) =>
  request(app).post(path).set('x-api-key', TEST_API_KEY).send({})

// Caso 9
describe('interruptor paymentsEnabled', () => {
  it('habilitado (por defecto) deja pasar la petición', async () => {
    const t = setup()
    expect((await post(t.app, '/api/v1/payments')).status).toBe(201)
    expect(t.handled()).toBe(1)
  })

  it.each(['/api/v1/payments', '/api/v1/payment-requests'])(
    'deshabilitado: POST %s → 503 PAYMENTS_DISABLED sin ejecutar el handler',
    async (path) => {
      const t = setup()
      await t.store.save({ paymentsEnabled: false }, 0)
      const res = await post(t.app, path)
      expect(res.status).toBe(503)
      expect(errorOf(res).code).toBe('PAYMENTS_DISABLED')
      expect(t.handled()).toBe(0)
    }
  )

  it('el cambio se aplica al vencer la caché de 30 s', async () => {
    const t = setup()
    expect((await post(t.app, '/api/v1/payments')).status).toBe(201)
    await t.store.save({ paymentsEnabled: false }, 0)
    expect((await post(t.app, '/api/v1/payments')).status).toBe(201)
    t.advance(31_000)
    expect((await post(t.app, '/api/v1/payments')).status).toBe(503)
  })

  it('solo afecta a las rutas que declaran el interruptor (las consultas siguen)', async () => {
    const t = setup()
    await t.store.save({ paymentsEnabled: false }, 0)
    const res = await request(t.app)
      .get('/api/v1/payments')
      .set('x-api-key', TEST_API_KEY)
    expect(res.status).toBe(200)
  })
})
