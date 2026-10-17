import type {
  EditableSettings,
  EditableSettingsProvider,
  SettingsStore,
  VersionedSettings
} from './editable-settings.js'
import type { Settings } from './settings-provider.js'

export interface StoreSettingsProviderOptions {
  store: SettingsStore
  defaults: EditableSettings
  ttlMs?: number
  now?: () => number
}

function resolveSettings(
  defaults: EditableSettings,
  values: Partial<EditableSettings>
): EditableSettings {
  return {
    walletProviderBaseUrl: values.walletProviderBaseUrl ?? defaults.walletProviderBaseUrl,
    allowedWalletHosts: [...(values.allowedWalletHosts ?? defaults.allowedWalletHosts)],
    maxPaymentAmounts: { ...(values.maxPaymentAmounts ?? defaults.maxPaymentAmounts) },
    dailySpendLimits: { ...(values.dailySpendLimits ?? defaults.dailySpendLimits) },
    feePercentage: values.feePercentage ?? defaults.feePercentage,
    linkAuthTtlSeconds: values.linkAuthTtlSeconds ?? defaults.linkAuthTtlSeconds,
    frontendResultUrl: values.frontendResultUrl ?? defaults.frontendResultUrl,
    paymentsEnabled: values.paymentsEnabled ?? defaults.paymentsEnabled
  }
}

function cloneSettings(settings: EditableSettings): EditableSettings {
  return {
    ...settings,
    allowedWalletHosts: [...settings.allowedWalletHosts],
    maxPaymentAmounts: { ...settings.maxPaymentAmounts },
    dailySpendLimits: { ...settings.dailySpendLimits }
  }
}

/**
 * `SettingsProvider` backed by a `SettingsStore` with a per-instance cache.
 * `getSettings()` exposes only the three `Settings` fields (existing contract).
 */
export function createStoreSettingsProvider({
  store,
  defaults,
  ttlMs = 30_000,
  now = Date.now
}: StoreSettingsProviderOptions): EditableSettingsProvider {
  let cache: { version: number; settings: EditableSettings; fetchedAt: number } | null =
    null

  const read = async (): Promise<{ version: number; settings: EditableSettings }> => {
    if (cache !== null && now() - cache.fetchedAt < ttlMs) {
      return { version: cache.version, settings: cache.settings }
    }
    const stored = await store.get()
    const fresh = {
      version: stored?.version ?? 0,
      settings: resolveSettings(defaults, stored?.values ?? {})
    }
    cache = { ...fresh, fetchedAt: now() }
    return fresh
  }

  return {
    async getSettings(): Promise<Settings> {
      const { settings } = await read()
      return {
        walletProviderBaseUrl: settings.walletProviderBaseUrl,
        allowedWalletHosts: [...settings.allowedWalletHosts],
        maxPaymentAmounts: { ...settings.maxPaymentAmounts }
      }
    },

    async getEditable(): Promise<VersionedSettings> {
      const { version, settings } = await read()
      return { version, settings: cloneSettings(settings) }
    },

    invalidate(): void {
      cache = null
    }
  }
}
