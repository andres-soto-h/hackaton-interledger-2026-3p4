import type { Amount } from '../../shared/money/types.js'

export type UserStatus = 'ACTIVE' | 'BLOCKED'

export interface User {
  id: string
  displayName: string
  /** Email captured at self-service registration; absent for enrollment/admin-created users. */
  email?: string
  walletAddress: string
  walletAssetCode: string
  status: UserStatus
  /** ISO 8601 in UTC. */
  createdAt: string
  /** ISO 8601 in UTC. */
  updatedAt: string
  /**
   * Incremented to invalidate the user's sessions (block, access reset).
   * Absent means 0; it only appears after a `bumpSessionVersion`.
   */
  sessionVersion?: number
}

/** A one-time passkey enrollment link (only its SHA-256 hash is stored). */
export interface Enrollment {
  tokenHash: string
  userId: string
  /** TTL in epoch seconds. */
  expiresAt: number
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
    email?: string
    walletAddress: string
    walletAssetCode: string
    /** Present when the registration uses an enrollment link. */
    enrollmentTokenHash?: string
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
