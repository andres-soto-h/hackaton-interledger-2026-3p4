import { describe, expect, it } from 'vitest'
import { buildAdminHarness, call, loginAsAdmin } from '../helpers/admin.js'

const CSP =
  "default-src 'self'; style-src 'self' cdn.jsdelivr.net; script-src 'self'; frame-ancestors 'none'"

// Caso 11
describe('headers de seguridad del panel', () => {
  const expectPanelHeaders = (headers: Record<string, unknown>) => {
    expect(headers['content-security-policy']).toBe(CSP)
    expect(headers['x-frame-options']).toBe('DENY')
    expect(String(headers['cache-control'])).toContain('no-store')
    expect(headers['x-content-type-options']).toBe('nosniff')
  }

  it('el login los lleva', async () => {
    const h = buildAdminHarness()
    expectPanelHeaders((await call(h.app, 'get', '/admin/login')).headers)
  })

  it('las páginas con sesión los llevan', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    for (const path of ['/admin', '/admin/settings']) {
      expectPanelHeaders(
        (await call(h.app, 'get', path).set('cookie', session.cookie)).headers
      )
    }
  })

  it('las redirecciones al login también', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', '/admin')
    expect(res.status).toBe(302)
    expectPanelHeaders(res.headers)
  })

  it('los assets llevan la CSP', async () => {
    const h = buildAdminHarness()
    expect(
      (await call(h.app, 'get', '/admin/assets/admin.css')).headers[
        'content-security-policy'
      ]
    ).toBe(CSP)
  })

  it('las páginas del panel no cargan scripts en línea ni externos', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    const page = await call(h.app, 'get', '/admin/settings').set('cookie', session.cookie)
    expect(page.text).not.toMatch(/<script(?![^>]*\bsrc="\/admin\/assets\/)[^>]*>/)
    expect(page.text).not.toMatch(/\son[a-z]+=/)
    expect(page.text).not.toContain('style="')
  })
})

describe('assets propios', () => {
  it('sirve el CSS y el JS del panel con su content-type', async () => {
    const h = buildAdminHarness()
    const css = await call(h.app, 'get', '/admin/assets/admin.css')
    expect(css.status).toBe(200)
    expect(css.headers['content-type']).toContain('text/css')
    const js = await call(h.app, 'get', '/admin/assets/admin.js')
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toMatch(/javascript/)
  })

  it('no sirve archivos que no son assets ni permite salir del directorio', async () => {
    const h = buildAdminHarness()
    for (const path of [
      '/admin/assets/nope.css',
      '/admin/assets/..%2f..%2fpackage.json',
      '/admin/assets/%2e%2e%2fpackage.json',
      '/admin/assets/'
    ]) {
      expect((await call(h.app, 'get', path)).status).toBe(404)
    }
  })

  it('los assets son públicos (los necesita la página de login)', async () => {
    const h = buildAdminHarness()
    expect((await call(h.app, 'get', '/admin/assets/admin.css')).status).toBe(200)
  })
})
