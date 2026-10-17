import { describe, expect, it } from 'vitest'
import { createStoreSettingsProvider } from '../../src/shared/settings/store-settings-provider.js'
import {
  buildAdminHarness,
  call,
  csrfOf,
  DEFAULT_SETTINGS,
  loginAsAdmin,
  ORIGIN,
  postSettings,
  validSettingsForm,
  versionOf
} from '../helpers/admin.js'

const openForm = async (h: ReturnType<typeof buildAdminHarness>) => {
  const session = await loginAsAdmin(h)
  const page = await call(h.app, 'get', '/admin/settings').set('cookie', session.cookie)
  return { session, page, version: versionOf(page.text) }
}

describe('página de configuración', () => {
  it('muestra el formulario con los valores actuales, la versión y el token CSRF', async () => {
    const h = buildAdminHarness()
    const { page } = await openForm(h)
    expect(page.status).toBe(200)
    for (const field of [
      'walletProviderBaseUrl',
      'allowedWalletHosts',
      'maxPaymentAmounts',
      'dailySpendLimits',
      'feePercentage',
      'linkAuthTtlSeconds',
      'frontendResultUrl',
      'paymentsEnabled'
    ]) {
      expect(page.text).toContain(`name="${field}"`)
    }
    expect(page.text).toContain('value="https://ilp.interledger-test.dev"')
    expect(page.text).toContain('name="version" value="0"')
    expect(csrfOf(page.text)).toBeTruthy()
  })

  it('advierte que cambiar el proveedor deja de permitir las wallets del anterior', async () => {
    const h = buildAdminHarness()
    const { page } = await openForm(h)
    expect(page.text).toContain('dejarán de estar permitidas')
  })
})

// Caso 6
describe('guardar configuración válida', () => {
  it('guarda, redirige, registra settings.updated y el proveedor lo devuelve tras vencer la caché', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    const otherInstance = createStoreSettingsProvider({
      store: h.settingsStore,
      defaults: DEFAULT_SETTINGS,
      now: () => h.clock.ms
    })
    await otherInstance.getSettings()

    const res = await postSettings(h, session, {
      ...validSettingsForm({ walletProviderBaseUrl: 'https://wallet.new.test' }),
      _csrf: session.csrf,
      version
    })
    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/^\/admin\/settings/)

    expect((await h.settingsStore.get())?.values.walletProviderBaseUrl).toBe(
      'https://wallet.new.test'
    )

    const events = await h.activityLog.list({ type: 'settings.updated' })
    expect(events.items).toHaveLength(1)
    expect(events.items[0]?.data).toEqual({
      setting: 'walletProviderBaseUrl',
      previous: 'https://ilp.interledger-test.dev',
      next: 'https://wallet.new.test'
    })
    expect(events.items[0]?.level).toBe('info')

    // La instancia que atendió el guardado ya lo ve; otra instancia espera a que venza la caché.
    expect((await h.settings.getSettings()).walletProviderBaseUrl).toBe(
      'https://wallet.new.test'
    )
    expect((await otherInstance.getSettings()).walletProviderBaseUrl).toBe(
      'https://ilp.interledger-test.dev'
    )
    h.clock.ms += 31_000
    expect((await otherInstance.getSettings()).walletProviderBaseUrl).toBe(
      'https://wallet.new.test'
    )
  })

  it('registra un evento por cada campo que cambió y ninguno por los que no', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    await postSettings(h, session, {
      ...validSettingsForm({ feePercentage: '2.5', paymentsEnabled: undefined }),
      _csrf: session.csrf,
      version
    })
    const events = await h.activityLog.list({ type: 'settings.updated' })
    const changed = events.items.map((e) => e.data.setting).sort()
    expect(changed).toEqual(['feePercentage', 'paymentsEnabled'])
    const stored = (await h.settingsStore.get())?.values
    expect(stored?.feePercentage).toBe('2.5')
    expect(stored?.paymentsEnabled).toBe(false)
  })

  it('sin cambios no crea eventos', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    const res = await postSettings(h, session, {
      ...validSettingsForm(),
      _csrf: session.csrf,
      version
    })
    expect(res.status).toBe(302)
    expect((await h.activityLog.list({ type: 'settings.updated' })).items).toEqual([])
  })

  it('muestra el historial de los últimos 20 cambios, escapado', async () => {
    const h = buildAdminHarness()
    const { session } = await openForm(h)
    for (let i = 1; i <= 22; i++) {
      await h.activityLog.record({
        type: 'settings.updated',
        message: 'Configuración cambiada',
        data: { setting: 'feePercentage', previous: `old${i}`, next: `new${i}` }
      })
    }
    await h.activityLog.record({
      type: 'settings.updated',
      message: 'x',
      data: {
        setting: 'frontendResultUrl',
        previous: '<script>alert(1)</script>',
        next: '"><img src=x>'
      }
    })
    const page = await call(h.app, 'get', '/admin/settings').set('cookie', session.cookie)
    expect(page.text).not.toContain('<script>alert(1)</script>')
    expect(page.text).not.toContain('<img src=x>')
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(page.text).toContain('new22')
    expect(page.text).toContain('new4')
    expect(page.text).not.toContain('new3<')
    expect(page.text).not.toContain('>new1<')
  })
})

// Caso 7
describe('guardar configuración inválida', () => {
  it.each([
    ['http://wallet.new.test'],
    ['https://10.0.0.1'],
    ['https://localhost'],
    ['https://x.test:8443'],
    ['https://u:p@x.test']
  ])(
    'rechaza walletProviderBaseUrl %j con 422, mensaje en el campo y sin guardar',
    async (url) => {
      const h = buildAdminHarness()
      const { session, version } = await openForm(h)
      const res = await postSettings(h, session, {
        ...validSettingsForm({ walletProviderBaseUrl: url }),
        _csrf: session.csrf,
        version
      })
      expect(res.status).toBe(422)
      expect(res.text).toContain('data-field="walletProviderBaseUrl"')
      expect(res.text).not.toContain('data-field="feePercentage"')
      expect(await h.settingsStore.get()).toBeNull()
      expect((await h.activityLog.list({})).items).toEqual([])
    }
  )

  it('devuelve el formulario con lo que el administrador escribió (escapado)', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    const res = await postSettings(h, session, {
      ...validSettingsForm({
        walletProviderBaseUrl: 'http://"><script>alert(1)</script>'
      }),
      _csrf: session.csrf,
      version
    })
    expect(res.status).toBe(422)
    expect(res.text).not.toContain('<script>alert(1)</script>')
  })

  it('una comisión fuera de rango o con demasiados decimales se rechaza', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    for (const fee of ['11', '0.0005']) {
      const res = await postSettings(h, session, {
        ...validSettingsForm({ feePercentage: fee }),
        _csrf: session.csrf,
        version
      })
      expect(res.status).toBe(422)
      expect(res.text).toContain('data-field="feePercentage"')
    }
  })
})

// Caso 8
describe('conflicto de versión', () => {
  it('dos guardados con la misma versión: el segundo recibe aviso de conflicto y nada se pierde', async () => {
    const h = buildAdminHarness()
    const first = await openForm(h)
    const second = await openForm(h)
    expect(second.version).toBe(first.version)

    const ok = await postSettings(h, first.session, {
      ...validSettingsForm({ feePercentage: '1' }),
      _csrf: first.session.csrf,
      version: first.version
    })
    expect(ok.status).toBe(302)

    const conflict = await postSettings(h, second.session, {
      ...validSettingsForm({ feePercentage: '7' }),
      _csrf: second.session.csrf,
      version: second.version
    })
    expect(conflict.status).toBe(409)
    expect(conflict.text).toContain('otro administrador')
    expect((await h.settingsStore.get())?.values.feePercentage).toBe('1')
    // El formulario recargado trae la versión nueva para reintentar.
    expect(versionOf(conflict.text)).toBe('1')
  })
})

describe('protección de la página', () => {
  it('guardar sin token CSRF → 403 y no cambia nada', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    const res = await postSettings(h, session, {
      ...validSettingsForm({ feePercentage: '5' }),
      version
    })
    expect(res.status).toBe(403)
    expect(await h.settingsStore.get()).toBeNull()
  })

  it('guardar con Origin ajeno → 403', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    const res = await postSettings(
      h,
      session,
      { ...validSettingsForm({ feePercentage: '5' }), _csrf: session.csrf, version },
      { origin: 'https://evil.example' }
    )
    expect(res.status).toBe(403)
    expect(await h.settingsStore.get()).toBeNull()
  })

  it('el Origin propio sí se acepta', async () => {
    const h = buildAdminHarness()
    const { session, version } = await openForm(h)
    const res = await postSettings(
      h,
      session,
      { ...validSettingsForm({ feePercentage: '5' }), _csrf: session.csrf, version },
      { origin: ORIGIN }
    )
    expect(res.status).toBe(302)
  })
})
