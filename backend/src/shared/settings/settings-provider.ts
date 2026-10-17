import type { Config } from '../../config/env.js'

/** Editable configuration exposed through a provider (specs 003 and 020). */
export interface Settings {
  walletProviderBaseUrl: string
  allowedWalletHosts: string[]
  maxPaymentAmounts: Record<string, string>
}

export interface SettingsProvider {
  getSettings(): Promise<Settings>
}

/** Reads the settings from the environment-provided config, returning copies. */
export function createEnvSettingsProvider(config: Config): SettingsProvider {
  return {
    getSettings(): Promise<Settings> {
      return Promise.resolve({
        walletProviderBaseUrl: config.walletProviderBaseUrl,
        allowedWalletHosts: [...config.allowedWalletHosts],
        maxPaymentAmounts: { ...config.maxPaymentAmounts }
      })
    }
  }
}
