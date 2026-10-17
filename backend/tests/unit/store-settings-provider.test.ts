import { describe, expect, it } from 'vitest'
import { createEnvSettingsProvider } from '../../src/shared/settings/settings-provider.js'
import { createInMemorySettingsStore } from '../../src/shared/settings/in-memory-settings-store.js'
import { createStoreSettingsProvider } from '../../src/shared/settings/store-settings-provider.js'
import type { EditableSettings } from '../../src/shared/settings/editable-settings.js'
import { testConfig } from '../helpers/app.js'

const defaults: EditableSettings = {
  walletProviderBaseUrl: 'https://ilp.interledger-test.dev',
  allowedWalletHosts: [],
  maxPaymentAmounts: { USD: '1000' },
  dailySpendLimits: { USD: '200' },
  feePercentage: '0',
  linkAuthTtlSeconds: 600,
  frontendResultUrl: '',
  paymentsEnabled: true
}

const setup = () => {
  let nowMs = Date.UTC(2026, 9, 17, 12, 0, 0)
  const store = createInMemorySettingsStore()
  const make = () => createStoreSettingsProvider({ store, defaults, now: () => nowMs })
  return {
    store,
    make,
    advance: (ms: number) => {
      nowMs += ms
    }
  }
}

// Caso 13: mismos valores por defecto que el proveedor de entorno.
describe('SettingsProvider respaldado por almacén', () => {
  it('sin registro guardado devuelve los valores por defecto (los mismos que el de entorno)', async () => {
    const { make } = setup()
    const fromStore = await make().getSettings()
    const fromEnv = await createEnvSettingsProvider(testConfig).getSettings()
    expect(fromStore).toEqual(fromEnv)
  })

  it('getEditable devuelve versión 0 y todos los campos editables por defecto', async () => {
    const { make } = setup()
    expect(await make().getEditable()).toEqual({ version: 0, settings: defaults })
  })

  it('lo guardado pisa el valor por defecto; lo no guardado conserva el del entorno', async () => {
    const { make, store } = setup()
    await store.save({ walletProviderBaseUrl: 'https://wallet.new.test' }, 0)
    const { version, settings } = await make().getEditable()
    expect(version).toBe(1)
    expect(settings.walletProviderBaseUrl).toBe('https://wallet.new.test')
    expect(settings.maxPaymentAmounts).toEqual({ USD: '1000' })
    expect(settings.paymentsEnabled).toBe(true)
  })

  it('cachea 30 s por instancia: otra instancia ve el cambio solo al vencer la caché', async () => {
    const { make, store, advance } = setup()
    const instance = make()
    expect((await instance.getSettings()).walletProviderBaseUrl).toBe(
      'https://ilp.interledger-test.dev'
    )

    await store.save({ walletProviderBaseUrl: 'https://wallet.new.test' }, 0)

    advance(29_000)
    expect((await instance.getSettings()).walletProviderBaseUrl).toBe(
      'https://ilp.interledger-test.dev'
    )
    advance(2_000)
    expect((await instance.getSettings()).walletProviderBaseUrl).toBe(
      'https://wallet.new.test'
    )
  })

  it('invalidate() fuerza la lectura inmediata', async () => {
    const { make, store } = setup()
    const instance = make()
    await instance.getSettings()
    await store.save({ feePercentage: '3' }, 0)
    instance.invalidate()
    expect((await instance.getEditable()).settings.feePercentage).toBe('3')
  })

  it('devuelve copias: modificar el resultado no cambia la caché', async () => {
    const { make } = setup()
    const instance = make()
    const first = await instance.getSettings()
    first.allowedWalletHosts.push('evil.test')
    first.maxPaymentAmounts.USD = '999999'
    const second = await instance.getSettings()
    expect(second.allowedWalletHosts).toEqual([])
    expect(second.maxPaymentAmounts).toEqual({ USD: '1000' })
  })
})
