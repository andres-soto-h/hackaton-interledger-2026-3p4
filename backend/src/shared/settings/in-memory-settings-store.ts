import {
  SettingsConflictError,
  type EditableSettings,
  type SettingsStore,
  type StoredSettings
} from './editable-settings.js'

function cloneValues(values: Partial<EditableSettings>): Partial<EditableSettings> {
  return {
    ...values,
    ...(values.allowedWalletHosts !== undefined
      ? { allowedWalletHosts: [...values.allowedWalletHosts] }
      : {}),
    ...(values.maxPaymentAmounts !== undefined
      ? { maxPaymentAmounts: { ...values.maxPaymentAmounts } }
      : {}),
    ...(values.dailySpendLimits !== undefined
      ? { dailySpendLimits: { ...values.dailySpendLimits } }
      : {})
  }
}

/** In-memory `SettingsStore` with atomic saves (serialized, copy-on-read/write). */
export function createInMemorySettingsStore(): SettingsStore {
  let record: StoredSettings | null = null
  let tail: Promise<unknown> = Promise.resolve()

  return {
    get(): Promise<StoredSettings | null> {
      return Promise.resolve(
        record === null
          ? null
          : { version: record.version, values: cloneValues(record.values) }
      )
    },

    save(
      values: Partial<EditableSettings>,
      expectedVersion: number
    ): Promise<{ version: number }> {
      const operation = tail.then(() => {
        const current = record?.version ?? 0
        if (current !== expectedVersion) throw new SettingsConflictError()
        const version = current + 1
        record = { version, values: cloneValues(values) }
        return { version }
      })
      tail = operation.catch(() => undefined)
      return operation
    }
  }
}
