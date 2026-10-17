import type { Settings, SettingsProvider } from './settings-provider.js'

/** Editable configuration (spec 020), extending the runtime `Settings`. */
export interface EditableSettings extends Settings {
  dailySpendLimits: Record<string, string>
  feePercentage: string
  linkAuthTtlSeconds: number
  frontendResultUrl: string
  paymentsEnabled: boolean
}

export interface VersionedSettings {
  version: number
  settings: EditableSettings
}

export interface StoredSettings {
  version: number
  values: Partial<EditableSettings>
}

/** Persistence port for editable settings, guarded by a version number. */
export interface SettingsStore {
  get(): Promise<StoredSettings | null>
  /** `expectedVersion` is 0 when no record exists yet; throws on mismatch. */
  save(
    values: Partial<EditableSettings>,
    expectedVersion: number
  ): Promise<{ version: number }>
}

export class SettingsConflictError extends Error {
  constructor() {
    super('Settings were modified concurrently')
    this.name = 'SettingsConflictError'
  }
}

export interface EditableSettingsProvider extends SettingsProvider {
  getEditable(): Promise<VersionedSettings>
  invalidate(): void
}
