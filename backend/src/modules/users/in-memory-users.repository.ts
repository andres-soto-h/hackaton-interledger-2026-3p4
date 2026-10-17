import type { Challenge, Credential, User, UserStatus } from './user.types.js'
import { WalletAlreadyRegisteredError, type UsersRepository } from './users.repository.js'

/** In-memory implementation for local runs and tests (Lambda uses DynamoDB). */
export function createInMemoryUsersRepository(): UsersRepository {
  const users = new Map<string, User>()
  const credentials = new Map<string, Credential>()
  const credentialIdsByUser = new Map<string, string[]>()
  const userIdByWallet = new Map<string, string>()
  const challenges = new Map<string, Challenge>()

  const listCredentialIds = (userId: string): string[] => {
    const ids = credentialIdsByUser.get(userId)
    return ids === undefined ? [] : [...ids]
  }

  return {
    createUserWithCredential(user, credential) {
      if (userIdByWallet.has(user.walletAddress)) {
        return Promise.reject(new WalletAlreadyRegisteredError())
      }
      users.set(user.id, structuredClone(user))
      credentials.set(credential.id, structuredClone(credential))
      credentialIdsByUser.set(user.id, [...listCredentialIds(user.id), credential.id])
      userIdByWallet.set(user.walletAddress, user.id)
      return Promise.resolve()
    },

    getUser(id) {
      const user = users.get(id)
      return Promise.resolve(user === undefined ? null : structuredClone(user))
    },

    findUserByWallet(walletAddress) {
      const userId = userIdByWallet.get(walletAddress)
      if (userId === undefined) return Promise.resolve(null)
      const user = users.get(userId)
      return Promise.resolve(user === undefined ? null : structuredClone(user))
    },

    getCredential(credentialId) {
      const credential = credentials.get(credentialId)
      return Promise.resolve(
        credential === undefined ? null : structuredClone(credential)
      )
    },

    listCredentials(userId) {
      const items = listCredentialIds(userId)
        .map((id) => credentials.get(id))
        .filter((credential): credential is Credential => credential !== undefined)
      return Promise.resolve(items.map((credential) => structuredClone(credential)))
    },

    updateCredentialUsage(credentialId, change) {
      const credential = credentials.get(credentialId)
      if (credential !== undefined) {
        credentials.set(
          credentialId,
          structuredClone({
            ...credential,
            counter: change.counter,
            lastUsedAt: change.lastUsedAt
          })
        )
      }
      return Promise.resolve()
    },

    setUserStatus(userId, status: UserStatus, updatedAt) {
      const user = users.get(userId)
      if (user !== undefined) {
        users.set(userId, structuredClone({ ...user, status, updatedAt }))
      }
      return Promise.resolve()
    },

    deleteUserAndCredentials(userId) {
      const user = users.get(userId)
      if (user !== undefined) {
        users.delete(userId)
        userIdByWallet.delete(user.walletAddress)
        for (const credentialId of listCredentialIds(userId)) {
          credentials.delete(credentialId)
        }
        credentialIdsByUser.delete(userId)
      }
      return Promise.resolve()
    },

    createChallenge(challenge) {
      challenges.set(challenge.id, structuredClone(challenge))
      return Promise.resolve()
    },

    consumeChallenge(id, nowSeconds) {
      const challenge = challenges.get(id)
      if (challenge === undefined) return Promise.resolve(null)
      challenges.delete(id)
      if (challenge.expiresAt <= nowSeconds) return Promise.resolve(null)
      return Promise.resolve(structuredClone(challenge))
    }
  }
}
