import { describe, expect, it } from 'vitest'
import { createEnvSettingsProvider } from '../../src/shared/settings/settings-provider.js'
import { testConfig } from '../helpers/app.js'

describe('SettingsProvider desde el entorno', () => {
  it('expone la configuración editable desde el panel', async () => {
    const provider = createEnvSettingsProvider({
      ...testConfig,
      walletProviderBaseUrl: 'https://wallet.example',
      allowedWalletHosts: ['pay.example'],
      maxPaymentAmounts: { USD: '500', MXN: '9000' }
    })

    expect(await provider.getSettings()).toEqual({
      walletProviderBaseUrl: 'https://wallet.example',
      allowedWalletHosts: ['pay.example'],
      maxPaymentAmounts: { USD: '500', MXN: '9000' }
    })
  })

  it('devuelve copias: modificar el resultado no cambia la configuración', async () => {
    const provider = createEnvSettingsProvider(testConfig)

    const first = await provider.getSettings()
    first.allowedWalletHosts.push('evil.example')
    first.maxPaymentAmounts.USD = '999999'

    const second = await provider.getSettings()
    expect(second.allowedWalletHosts).toEqual([])
    expect(second.maxPaymentAmounts).toEqual({ USD: '1000' })
  })
})
