import type { Challenge, Credential, Enrollment, User, UserStatus } from './user.types.js'

/** The wallet address already belongs to an account. */
export class WalletAlreadyRegisteredError extends Error {
  constructor(message = 'Wallet address already registered') {
    super(message)
    this.name = 'WalletAlreadyRegisteredError'
  }
}

/** The email already belongs to an account. */
export class EmailAlreadyRegisteredError extends Error {
  constructor(message = 'Email already registered') {
    super(message)
    this.name = 'EmailAlreadyRegisteredError'
  }
}

/** The user does not exist. */
export class UserNotFoundError extends Error {
  constructor(message = 'User not found') {
    super(message)
    this.name = 'UserNotFoundError'
  }
}

export interface UpdateUserChanges {
  displayName?: string
  walletAddress?: string
  walletAssetCode?: string
}

export interface UsersRepository {
  /**
   * Atomically creates a user with its first credential. Throws
   * `WalletAlreadyRegisteredError` and stores nothing when the wallet address
   * already belongs to another account.
   */
  createUserWithCredential(user: User, credential: Credential): Promise<void>
  getUser(id: string): Promise<User | null>
  findUserByWallet(walletAddress: string): Promise<User | null>
  findUserByEmail(email: string): Promise<User | null>
  getCredential(credentialId: string): Promise<Credential | null>
  listCredentials(userId: string): Promise<Credential[]>
  updateCredentialUsage(
    credentialId: string,
    change: { counter: number; lastUsedAt: string }
  ): Promise<void>
  setUserStatus(userId: string, status: UserStatus, updatedAt: string): Promise<void>
  /**
   * Deletes the user, its credentials and the wallet uniqueness record. A
   * missing user is not an error.
   */
  deleteUserAndCredentials(userId: string): Promise<void>
  createChallenge(challenge: Challenge): Promise<void>
  /**
   * Atomically consumes a single-use challenge: returns it (or `null` when it
   * does not exist, was already used or expired) and removes it from storage.
   */
  consumeChallenge(id: string, nowSeconds: number): Promise<Challenge | null>

  // Spec 021: admin panel and enrollment links.

  /**
   * Atomically creates a user without credentials. Throws
   * `WalletAlreadyRegisteredError` and stores nothing when the wallet address
   * already belongs to another account.
   */
  createUser(user: User): Promise<void>
  /** Every user, newest (`createdAt`) first. */
  listUsers(): Promise<User[]>
  /**
   * Applies the given changes to a user and returns it updated. When the
   * wallet address changes, the wallet uniqueness moves atomically
   * (`WalletAlreadyRegisteredError` if it belongs to another account, without
   * any change). `UserNotFoundError` when the user does not exist.
   */
  updateUser(userId: string, changes: UpdateUserChanges, updatedAt: string): Promise<User>
  /**
   * Atomically increments the user's session version (0 → 1 → 2 …) and returns
   * the new version. `UserNotFoundError` when the user does not exist.
   */
  bumpSessionVersion(userId: string, updatedAt: string): Promise<number>
  /** Adds a credential to an existing user. */
  addCredential(credential: Credential): Promise<void>
  /**
   * Deletes credentials of a user and returns how many were deleted. Without
   * `credentialIds` it deletes every credential of the user; otherwise only
   * the given ids that belong to that user are counted and deleted.
   */
  deleteCredentials(userId: string, credentialIds?: string[]): Promise<number>
  createEnrollment(enrollment: Enrollment): Promise<void>
  /**
   * Reads an enrollment without consuming it; `null` when it does not exist or
   * has expired (`expiresAt <= nowSeconds`).
   */
  getEnrollment(tokenHash: string, nowSeconds: number): Promise<Enrollment | null>
  /**
   * Atomically consumes a single-use enrollment: only one of many parallel
   * callers wins; `null` when it does not exist or has expired.
   */
  consumeEnrollment(tokenHash: string, nowSeconds: number): Promise<Enrollment | null>
  /** Invalidates every enrollment link of a user. */
  deleteEnrollments(userId: string): Promise<void>
}
