import { beforeEach, describe, expect, it } from 'vitest'
import {
  SettingsConflictError,
  type SettingsStore
} from '../../src/shared/settings/editable-settings.js'

/** Contract every `SettingsStore` implementation must pass (caso 13 del spec 020). */
export function runSettingsStoreContract(name: string, make: () => SettingsStore): void {
  describe(`SettingsStore (${name})`, () => {
    let store: SettingsStore
    beforeEach(() => {
      store = make()
    })

    it('sin registro devuelve null', async () => {
      expect(await store.get()).toBeNull()
    })

    it('el primer guardado usa la versión esperada 0 y crea la versión 1', async () => {
      const saved = await store.save({ feePercentage: '1.5' }, 0)
      expect(saved).toEqual({ version: 1 })
      expect(await store.get()).toEqual({ version: 1, values: { feePercentage: '1.5' } })
    })

    it('cada guardado exitoso incrementa la versión y reemplaza los valores', async () => {
      await store.save({ feePercentage: '1', paymentsEnabled: false }, 0)
      await store.save({ feePercentage: '2' }, 1)
      expect(await store.get()).toEqual({ version: 2, values: { feePercentage: '2' } })
    })

    it('guardar con una versión vieja lanza SettingsConflictError y no cambia nada', async () => {
      await store.save({ feePercentage: '1' }, 0)
      await expect(store.save({ feePercentage: '9' }, 0)).rejects.toBeInstanceOf(
        SettingsConflictError
      )
      expect(await store.get()).toEqual({ version: 1, values: { feePercentage: '1' } })
    })

    it('dos guardados concurrentes con la misma versión: solo uno gana', async () => {
      const results = await Promise.allSettled([
        store.save({ feePercentage: '1' }, 0),
        store.save({ feePercentage: '2' }, 0)
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    })

    it('devuelve copias: modificar el resultado no cambia lo guardado', async () => {
      await store.save({ allowedWalletHosts: ['a.test'] }, 0)
      const read = await store.get()
      read?.values.allowedWalletHosts?.push('evil.test')
      expect((await store.get())?.values.allowedWalletHosts).toEqual(['a.test'])
    })
  })
}
