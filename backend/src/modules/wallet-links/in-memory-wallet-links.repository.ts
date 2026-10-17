import { ConflictError } from '../payments/payments.repository.js'
import type { WalletLink } from './wallet-link.types.js'
import type { WalletLinksRepository } from './wallet-links.repository.js'

const spentKey = (linkId: string, periodStart: string): string =>
  `${linkId}\u0000${periodStart}`

/** Deep-copies the stored value so callers never alias the repository state. */
const clone = <T>(value: T): T => structuredClone(value)

/**
 * In-memory wallet-links repository (spec 023). Reservations are synchronous
 * read-modify-write operations (no `await` between reading and writing), which
 * makes them atomic under the single-threaded event loop.
 */
export function createInMemoryWalletLinksRepository(): WalletLinksRepository {
  const links = new Map<string, WalletLink>()
  const spent = new Map<string, bigint>()

  return {
    create(link) {
      if (links.has(link.id)) {
        return Promise.reject(new ConflictError('Wallet link already exists'))
      }
      links.set(link.id, clone(link))
      return Promise.resolve()
    },

    get(id) {
      const link = links.get(id)
      return Promise.resolve(link === undefined ? null : clone(link))
    },

    findLatestByUser(userId) {
      let latest: WalletLink | undefined
      for (const link of links.values()) {
        if (link.userId !== userId) continue
        if (latest === undefined || link.createdAt > latest.createdAt) latest = link
      }
      return Promise.resolve(latest === undefined ? null : clone(latest))
    },

    findActiveByUser(userId) {
      let active: WalletLink | undefined
      for (const link of links.values()) {
        if (link.userId !== userId || link.status !== 'ACTIVE') continue
        if (active === undefined || link.createdAt > active.createdAt) active = link
      }
      return Promise.resolve(active === undefined ? null : clone(active))
    },

    update(id, changes, cond) {
      const current = links.get(id)
      if (current === undefined) {
        return Promise.reject(new ConflictError('Wallet link does not exist'))
      }
      if (cond?.expectedStatus !== undefined && current.status !== cond.expectedStatus) {
        return Promise.reject(new ConflictError('Wallet link status changed'))
      }
      if (
        cond?.expectedTokenVersion !== undefined &&
        current.tokenVersion !== cond.expectedTokenVersion
      ) {
        return Promise.reject(new ConflictError('Wallet link token changed'))
      }

      const next = clone(current)
      const mutable = next as unknown as Record<string, unknown>
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete mutable[key]
        else mutable[key] = value
      }
      links.set(id, next)
      return Promise.resolve(clone(next))
    },

    getSpent(linkId, periodStart) {
      return Promise.resolve((spent.get(spentKey(linkId, periodStart)) ?? 0n).toString())
    },

    reserve({ linkId, periodStart, amount, limit }) {
      const key = spentKey(linkId, periodStart)
      const current = spent.get(key) ?? 0n
      const next = current + BigInt(amount)
      if (next > BigInt(limit)) {
        return Promise.resolve({ ok: false, spent: current.toString() })
      }
      spent.set(key, next)
      return Promise.resolve({ ok: true, spent: next.toString() })
    },

    release({ linkId, periodStart, amount }) {
      const key = spentKey(linkId, periodStart)
      const current = spent.get(key) ?? 0n
      const next = current - BigInt(amount)
      spent.set(key, next < 0n ? 0n : next)
      return Promise.resolve()
    }
  }
}
