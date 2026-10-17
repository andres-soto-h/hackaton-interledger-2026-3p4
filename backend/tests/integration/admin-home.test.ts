import { describe, expect, it } from 'vitest'
import type { PaymentsSummaryProvider } from '../../src/modules/admin/home-summary.js'
import { buildAdminHarness, call, loginAsAdmin } from '../helpers/admin.js'

const STATUSES = [
  'AWAITING_CONFIRMATION',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
]

const summary = (counts: Record<string, number>): PaymentsSummaryProvider => ({
  last24h: () => Promise.resolve(counts)
})

async function home(options: Parameters<typeof buildAdminHarness>[0]) {
  const h = buildAdminHarness(options)
  const session = await loginAsAdmin(h)
  return call(h.app, 'get', '/admin').set('cookie', session.cookie)
}

// Spec 020, tarea 7: página de inicio.
describe('GET /admin (inicio)', () => {
  it('muestra el conteo de las últimas 24 h por cada estado, con 0 para los ausentes', async () => {
    const res = await home({
      paymentsSummary: summary({ COMPLETED: 7, FAILED: 2 }),
      openPaymentsStatus: { check: () => Promise.resolve({ connected: true }) }
    })
    expect(res.status).toBe(200)
    for (const status of STATUSES) expect(res.text).toContain(status)
    expect(res.text).toMatch(/COMPLETED[\s\S]{0,120}>7</)
    expect(res.text).toMatch(/FAILED[\s\S]{0,120}>2</)
    expect(res.text).toMatch(/EXPIRED[\s\S]{0,120}>0</)
  })

  it('muestra "Conectado" cuando Open Payments responde', async () => {
    const res = await home({
      paymentsSummary: summary({}),
      openPaymentsStatus: { check: () => Promise.resolve({ connected: true }) }
    })
    expect(res.text).toContain('Conectado')
  })

  it('muestra el error cuando Open Payments no responde, escapado', async () => {
    const res = await home({
      paymentsSummary: summary({}),
      openPaymentsStatus: {
        check: () => Promise.resolve({ connected: false, error: '<b>OP_DOWN</b>' })
      }
    })
    expect(res.text).toContain('&lt;b&gt;OP_DOWN&lt;/b&gt;')
    expect(res.text).not.toContain('<b>OP_DOWN</b>')
    expect(res.text).not.toContain('Conectado')
  })

  it('sin proveedores configurados muestra "No disponible" y no falla', async () => {
    const res = await home({})
    expect(res.status).toBe(200)
    expect(res.text).toContain('No disponible')
  })

  it('si un proveedor lanza, la página sigue respondiendo 200 con "No disponible"', async () => {
    const res = await home({
      paymentsSummary: { last24h: () => Promise.reject(new Error('db down secret')) },
      openPaymentsStatus: { check: () => Promise.reject(new Error('boom secret')) }
    })
    expect(res.status).toBe(200)
    expect(res.text).toContain('No disponible')
    expect(res.text).not.toContain('secret')
  })

  it('conserva el enlace a la configuración y los headers de seguridad', async () => {
    const res = await home({})
    expect(res.text).toContain('href="/admin/settings"')
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
