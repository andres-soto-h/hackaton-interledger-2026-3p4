import type { User } from './user.types.js'
import type { UsersRepository } from './users.repository.js'

export interface PublicUser {
  id: string
  displayName: string
  walletAddress: string
  createdAt: string
}

export interface UsersService {
  toPublicUser(user: User): PublicUser
  deleteAccount(userId: string): Promise<void>
}

/** Account operations behind `GET/DELETE /api/v1/me`. */
export function createUsersService(
  users: UsersRepository,
  beforeDeleteAccount?: (userId: string) => Promise<void>
): UsersService {
  return {
    toPublicUser(user) {
      return {
        id: user.id,
        displayName: user.displayName,
        walletAddress: user.walletAddress,
        createdAt: user.createdAt
      }
    },

    async deleteAccount(userId) {
      if (beforeDeleteAccount !== undefined) {
        await beforeDeleteAccount(userId)
      }
      await users.deleteUserAndCredentials(userId)
    }
  }
}
