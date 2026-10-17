import { describe, expect, it } from 'vitest'
import type { FeeSummaryProvider } from '../../src/modules/fees/fee-summary.js'
import { buildAdminHarness, call, loginAsAdmin } from '../helpers/admin.js'

const provider = (): FeeSummaryProvider => ({
  summary: () =>
    Promise.resolve({
      byCurrency: {
        USD: { last24h: '0.38', total: '12.40' },
        MXN: { last24h: '5.00', total: '77.10' }
      },
      failedCount: 3
    })
})

async function home(options: Parameters<typeof buildAdminHarness>[0]) {
  const h = buildAdminHarness(options)
  const session = await loginAsAdmin(h)
  return call(h.app, 'get', '/admin').set('cookie', session.cookie)
}

// Caso 10 · resumen de comisiones en el inicio del panel (spec 020 + 024)
describe('GET /admin · comisiones', () => {
  it('muestra lo cobrado por moneda (24 h y total) y las comisiones fallidas', async () => {
    const res = await home({ feeSummary: provider() })
    expect(res.status).toBe(200)
    expect(res.text).toContain('Comisiones cobradas')
    for (const value of ['USD', '0.38', '12.40', 'MXN', '5.00', '77.10']) {
      expect(res.text).toContain(value)
    }
    expect(res.text).toMatch(/fallidas[\s\S]{0,120}>3</i)
  })

  it('sin proveedor no muestra la sección de comisiones', async () => {
    const res = await home({})
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('Comisiones cobradas')
  })

  it('escapa los códigos de moneda', async () => {
    const res = await home({
      feeSummary: {
        summary: () =>
          Promise.resolve({
            byCurrency: { '<b>X</b>': { last24h: '1', total: '1' } },
            failedCount: 0
          })
      }
    })
    expect(res.text).not.toContain('<b>X</b>')
  })
})
