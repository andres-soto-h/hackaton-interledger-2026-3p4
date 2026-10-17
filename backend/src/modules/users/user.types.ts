import type { Amount } from '../../shared/money/types.js'

export type UserStatus = 'ACTIVE' | 'BLOCKED'

export interface User {
  id: string
  displayName: string
  walletAddress: string
  walletAssetCode: string
  status: UserStatus
  /** ISO 8601 in UTC. */
  createdAt: string
  /** ISO 8601 in UTC. */
  updatedAt: string
}

export type CredentialDeviceType = 'singleDevice' | 'multiDevice'

export interface Credential {
  /** The WebAuthn credential id. */
  id: string
  userId: string
  publicKey: string
  counter: number
  transports?: string[]
  deviceType: CredentialDeviceType
  backedUp: boolean
  /** ISO 8601 in UTC. */
  createdAt: string
  /** ISO 8601 in UTC. */
  lastUsedAt?: string
}

export type ChallengeType = 'register' | 'login' | 'payment_confirmation'

export interface Challenge {
  id: string
  challenge: string
  type: ChallengeType
  /** Registration data kept until the challenge is verified. */
  pending?: {
    userId: string
    displayName: string
    walletAddress: string
    walletAssetCode: string
  }
  /** Payment being confirmed, kept until the challenge is consumed. */
  payment?: {
    paymentId: string
    userId: string
    totalDebit: Amount
  }
  /** TTL in epoch seconds. */
  expiresAt: number
}
