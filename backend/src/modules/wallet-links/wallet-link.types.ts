export type WalletLinkStatus =
  'PENDING_AUTHORIZATION' | 'AUTHORIZING' | 'ACTIVE' | 'REJECTED' | 'EXPIRED' | 'REVOKED'

export interface WalletLinkAuthorization {
  clientNonce: string
  finishNonce: string
  authServerUrl: string
  /** ISO 8601 in UTC. */
  expiresAt: string
}

export interface WalletLink {
  id: string
  userId: string
  walletAddress: string
  assetCode: string
  assetScale: number
  /** Daily allowance, decimal string. */
  dailyLimit: string
  interval: string
  periodTimezone: string
  status: WalletLinkStatus
  authorization?: WalletLinkAuthorization
  continueUri: string
  continueToken: string
  tokenCiphertext?: string
  tokenVersion: number
  /** ISO 8601 in UTC. */
  tokenExpiresAt?: string
  /** ISO 8601 in UTC. */
  createdAt: string
  /** ISO 8601 in UTC. */
  authorizedAt?: string
  /** ISO 8601 in UTC. */
  revokedAt?: string
}
