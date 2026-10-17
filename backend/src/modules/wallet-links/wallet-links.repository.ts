import type { WalletLink, WalletLinkStatus } from './wallet-link.types.js'

export interface ReserveResult {
  ok: boolean
  /** Minor units as a string. */
  spent: string
}

export interface UpdateCondition {
  expectedStatus?: WalletLinkStatus
  expectedTokenVersion?: number
}

/**
 * Storage for wallet links and their daily-spend reservations (spec 023). The
 * DynamoDB implementation (lote 2) fulfils the same contract, so the spend
 * counters are tracked in minor units with `BigInt` and never with floats.
 */
export interface WalletLinksRepository {
  /** Throws `ConflictError` when the id already exists. */
  create(link: WalletLink): Promise<void>
  get(id: string): Promise<WalletLink | null>
  findLatestByUser(userId: string): Promise<WalletLink | null>
  findActiveByUser(userId: string): Promise<WalletLink | null>
  /**
   * Updates fields; a field set to `undefined` is removed. Fails with
   * `ConflictError` when the id does not exist or a condition does not hold.
   */
  update(
    id: string,
    changes: Partial<WalletLink>,
    cond?: UpdateCondition
  ): Promise<WalletLink>
  getSpent(linkId: string, periodStart: string): Promise<string>
  /** Atomically reserves `amount` minor units within `limit`; never blocks. */
  reserve(input: {
    linkId: string
    periodStart: string
    amount: string
    limit: string
  }): Promise<ReserveResult>
  release(input: { linkId: string; periodStart: string; amount: string }): Promise<void>
}
