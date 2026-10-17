/** Summary of a user's wallet link shown on the admin detail page. */
export interface WalletLinkSummary {
  status: string
  dailyLimit?: string
  spentToday?: string
  assetCode?: string
}

/** Port for the wallet-link section (spec 023 wires the real implementation). */
export interface AdminWalletLinks {
  getSummary(userId: string): Promise<WalletLinkSummary | null>
  revoke(userId: string): Promise<void>
}

/** A recent payment of a user's wallet, for the admin detail page. */
export interface RecentPayment {
  id: string
  status: string
  amount?: string
  assetCode?: string
  /** ISO 8601 in UTC. */
  createdAt: string
}

/** Port for the recent-payments section (spec 004 wires the real implementation). */
export interface AdminPaymentsReader {
  listRecent(walletAddress: string, limit: number): Promise<RecentPayment[]>
}
