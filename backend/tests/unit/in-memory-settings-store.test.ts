import { createInMemorySettingsStore } from '../../src/shared/settings/in-memory-settings-store.js'
import { runSettingsStoreContract } from '../contract/settings-store.contract.js'

runSettingsStoreContract('memoria', () => createInMemorySettingsStore())
