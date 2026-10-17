import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError } from '../../src/modules/payments/payments.repository.js'
import type { WalletLink } from '../../src/modules/wallet-links/wallet-link.types.js'
import type { WalletLinksRepository } from '../../src/modules/wallet-links/wallet-links.repository.js'

const at = (minute: number): string =>
  new Date(Date.UTC(2026, 9, 17, 10, minute, 0)).toISOString()

export const buildWalletLink = (overrides: Partial<WalletLink> = {}): WalletLink => ({
  id: 'wl_01JAAAAAAAAAAAAAAAAAAAAAAA',
  userId: 'usr_alice',
  walletAddress: 'https://ilp.interledger-test.dev/alice',
  assetCode: 'USD',
  assetScale: 2,
  dailyLimit: '200.00',
  interval: 'R/2026-10-17T05:00:00Z/P1D',
  periodTimezone: 'America/Bogota',
  status: 'PENDING_AUTHORIZATION',
  authorization: {
    clientNonce: 'client-nonce-1',
    finishNonce: 'finish-nonce-1',
    authServerUrl: 'https://auth.interledger-test.dev',
    expiresAt: at(10)
  },
  continueUri: 'https://auth.interledger-test.dev/continue/c1',
  continueToken: 'continue-token-1',
  tokenVersion: 0,
  createdAt: at(0),
  ...overrides
})

const P1 = '2026-10-17T05:00:00.000Z'
const P2 = '2026-10-18T05:00:00.000Z'

// Caso 10 (contrato): lo cumplen la implementación en memoria y la de DynamoDB.
export function runWalletLinksRepositoryContract(
  name: string,
  factory: () => WalletLinksRepository | Promise<WalletLinksRepository>
): void {
  describe(`WalletLinksRepository (${name})`, () => {
    let repo: WalletLinksRepository
    beforeEach(async () => {
      repo = await factory()
    })

    describe('vinculaciones', () => {
      it('crea y lee una vinculación', async () => {
        const link = buildWalletLink()
        await repo.create(link)
        expect(await repo.get(link.id)).toEqual(link)
        expect(await repo.get('wl_missing')).toBeNull()
      })

      it('no permite crear dos veces el mismo id', async () => {
        await repo.create(buildWalletLink())
        await expect(repo.create(buildWalletLink())).rejects.toBeInstanceOf(ConflictError)
      })

      it('encuentra la última y la activa de un usuario', async () => {
        await repo.create(
          buildWalletLink({ id: 'wl_1', status: 'REJECTED', createdAt: at(0) })
        )
        await repo.create(
          buildWalletLink({ id: 'wl_2', status: 'ACTIVE', createdAt: at(1) })
        )
        await repo.create(
          buildWalletLink({ id: 'wl_3', status: 'EXPIRED', createdAt: at(2) })
        )
        await repo.create(
          buildWalletLink({ id: 'wl_4', userId: 'usr_bob', createdAt: at(3) })
        )

        expect((await repo.findLatestByUser('usr_alice'))?.id).toBe('wl_3')
        expect((await repo.findActiveByUser('usr_alice'))?.id).toBe('wl_2')
        expect(await repo.findActiveByUser('usr_bob')).toBeNull()
        expect(await repo.findLatestByUser('usr_nadie')).toBeNull()
      })

      it('actualiza campos y devuelve la vinculación nueva', async () => {
        await repo.create(buildWalletLink())
        const updated = await repo.update('wl_01JAAAAAAAAAAAAAAAAAAAAAAA', {
          status: 'ACTIVE',
          authorizedAt: at(2)
        })
        expect(updated.status).toBe('ACTIVE')
        expect((await repo.get(updated.id))?.authorizedAt).toBe(at(2))
      })

      it('un campo con undefined se borra', async () => {
        await repo.create(buildWalletLink({ tokenCiphertext: 'cipher' }))
        await repo.update('wl_01JAAAAAAAAAAAAAAAAAAAAAAA', {
          authorization: undefined,
          tokenCiphertext: undefined
        })
        const stored = await repo.get('wl_01JAAAAAAAAAAAAAAAAAAAAAAA')
        expect(stored?.authorization).toBeUndefined()
        expect(stored?.tokenCiphertext).toBeUndefined()
      })

      it('update condicional por estado: falla si el estado no coincide', async () => {
        await repo.create(buildWalletLink())
        await expect(
          repo.update(
            'wl_01JAAAAAAAAAAAAAAAAAAAAAAA',
            { status: 'ACTIVE' },
            { expectedStatus: 'AUTHORIZING' }
          )
        ).rejects.toBeInstanceOf(ConflictError)
        expect((await repo.get('wl_01JAAAAAAAAAAAAAAAAAAAAAAA'))?.status).toBe(
          'PENDING_AUTHORIZATION'
        )
      })

      it('update condicional por versión del token: solo uno de dos gana', async () => {
        await repo.create(buildWalletLink({ status: 'ACTIVE', tokenVersion: 1 }))
        const id = 'wl_01JAAAAAAAAAAAAAAAAAAAAAAA'
        const results = await Promise.allSettled([
          repo.update(
            id,
            { tokenVersion: 2, tokenCiphertext: 'a' },
            { expectedTokenVersion: 1 }
          ),
          repo.update(
            id,
            { tokenVersion: 2, tokenCiphertext: 'b' },
            { expectedTokenVersion: 1 }
          )
        ])
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
        expect((await repo.get(id))?.tokenVersion).toBe(2)
      })

      it('un solo uso: dos transiciones condicionales en paralelo, solo una gana', async () => {
        await repo.create(buildWalletLink())
        const id = 'wl_01JAAAAAAAAAAAAAAAAAAAAAAA'
        const results = await Promise.allSettled([
          repo.update(
            id,
            { status: 'AUTHORIZING' },
            { expectedStatus: 'PENDING_AUTHORIZATION' }
          ),
          repo.update(
            id,
            { status: 'AUTHORIZING' },
            { expectedStatus: 'PENDING_AUTHORIZATION' }
          )
        ])
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      })

      it('update de una vinculación inexistente falla con ConflictError', async () => {
        await expect(
          repo.update('wl_missing', { status: 'ACTIVE' })
        ).rejects.toBeInstanceOf(ConflictError)
      })
    })

    describe('reservas del monto diario (en unidades menores)', () => {
      const reserve = (amount: string, periodStart = P1, limit = '20000') =>
        repo.reserve({ linkId: 'wl_1', periodStart, amount, limit })

      it('sin gasto, el gastado es 0', async () => {
        expect(await repo.getSpent('wl_1', P1)).toBe('0')
      })

      it('reserva hasta el límite exacto y rechaza lo que lo supera', async () => {
        expect(await reserve('15000')).toEqual({ ok: true, spent: '15000' })
        expect(await reserve('5000')).toEqual({ ok: true, spent: '20000' })
        expect(await reserve('1')).toEqual({ ok: false, spent: '20000' })
        expect(await repo.getSpent('wl_1', P1)).toBe('20000')
      })

      it('una reserva rechazada no cambia lo gastado', async () => {
        await reserve('15000')
        expect((await reserve('6000')).ok).toBe(false)
        expect(await repo.getSpent('wl_1', P1)).toBe('15000')
      })

      it('dos reservas en paralelo que juntas superan el límite: solo una gana', async () => {
        const results = await Promise.all([reserve('15000'), reserve('15000')])
        expect(results.filter((r) => r.ok)).toHaveLength(1)
        expect(await repo.getSpent('wl_1', P1)).toBe('15000')
      })

      it('release devuelve lo reservado y nunca baja de 0', async () => {
        await reserve('10000')
        await repo.release({ linkId: 'wl_1', periodStart: P1, amount: '4000' })
        expect(await repo.getSpent('wl_1', P1)).toBe('6000')
        await repo.release({ linkId: 'wl_1', periodStart: P1, amount: '999999' })
        expect(await repo.getSpent('wl_1', P1)).toBe('0')
      })

      it('cada periodo lleva su propia cuenta', async () => {
        await reserve('20000', P1)
        expect(await reserve('20000', P2)).toEqual({ ok: true, spent: '20000' })
        expect(await repo.getSpent('wl_1', P1)).toBe('20000')
      })

      it('cada vinculación lleva su propia cuenta', async () => {
        await reserve('20000')
        const other = await repo.reserve({
          linkId: 'wl_2',
          periodStart: P1,
          amount: '20000',
          limit: '20000'
        })
        expect(other.ok).toBe(true)
      })

      it('una reserva mayor al límite en una sola vez se rechaza', async () => {
        expect(await reserve('20001')).toEqual({ ok: false, spent: '0' })
      })
    })
  })
}
