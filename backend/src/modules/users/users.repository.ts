import type { Challenge, Credential, User, UserStatus } from './user.types.js'

/** The wallet address already belongs to an account. */
export class WalletAlreadyRegisteredError extends Error {
  constructor(message = 'Wallet address already registered') {
    super(message)
    this.name = 'WalletAlreadyRegisteredError'
  }
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
}
