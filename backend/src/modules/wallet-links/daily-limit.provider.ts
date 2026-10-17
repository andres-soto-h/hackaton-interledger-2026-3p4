export interface DailyLimitProvider {
  /** Daily allowance for a currency as a decimal string, or `null` if unsupported. */
  getDailyLimit(assetCode: string): Promise<string | null>
}

/** Fixed limits for tests and local runs; the admin panel (spec 020) will provide a dynamic one. */
export function createStaticDailyLimitProvider(
  map: Record<string, string>
): DailyLimitProvider {
  return {
    getDailyLimit(assetCode) {
      return Promise.resolve(map[assetCode] ?? null)
    }
  }
}

/** Reads the daily allowances from the editable settings, so the admin panel changes them live. */
export function createSettingsDailyLimitProvider(settings: {
  getEditable(): Promise<{ settings: { dailySpendLimits: Record<string, string> } }>
}): DailyLimitProvider {
  return {
    async getDailyLimit(assetCode) {
      const { settings: current } = await settings.getEditable()
      return current.dailySpendLimits[assetCode] ?? null
    }
  }
}
