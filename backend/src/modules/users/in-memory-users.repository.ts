import type { Challenge, Credential, Enrollment, User, UserStatus } from './user.types.js'
import {
  EmailAlreadyRegisteredError,
  UserNotFoundError,
  WalletAlreadyRegisteredError,
  type UsersRepository
} from './users.repository.js'

/** In-memory implementation for local runs and tests (Lambda uses DynamoDB). */
export function createInMemoryUsersRepository(): UsersRepository {
  const users = new Map<string, User>()
  const credentials = new Map<string, Credential>()
  const credentialIdsByUser = new Map<string, string[]>()
  const userIdByWallet = new Map<string, string>()
  const userIdByEmail = new Map<string, string>()
  const challenges = new Map<string, Challenge>()
  const enrollments = new Map<string, Enrollment>()

  const listCredentialIds = (userId: string): string[] => {
    const ids = credentialIdsByUser.get(userId)
    return ids === undefined ? [] : [...ids]
  }

  const userOrThrow = (userId: string): User => {
    const user = users.get(userId)
    if (user === undefined) throw new UserNotFoundError()
    return user
  }

  const listEnrollmentsOf = (userId: string): string[] =>
    [...enrollments.entries()]
      .filter(([, enrollment]) => enrollment.userId === userId)
      .map(([tokenHash]) => tokenHash)

  return {
    createUserWithCredential(user, credential) {
      if (userIdByWallet.has(user.walletAddress)) {
        return Promise.reject(new WalletAlreadyRegisteredError())
      }
      if (user.email !== undefined && userIdByEmail.has(user.email)) {
        return Promise.reject(new EmailAlreadyRegisteredError())
      }
      users.set(user.id, structuredClone(user))
      credentials.set(credential.id, structuredClone(credential))
      credentialIdsByUser.set(user.id, [...listCredentialIds(user.id), credential.id])
      userIdByWallet.set(user.walletAddress, user.id)
      if (user.email !== undefined) userIdByEmail.set(user.email, user.id)
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

    findUserByEmail(email) {
      const userId = userIdByEmail.get(email)
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
        if (user.email !== undefined) userIdByEmail.delete(user.email)
        for (const credentialId of listCredentialIds(userId)) {
          credentials.delete(credentialId)
        }
        credentialIdsByUser.delete(userId)
        for (const tokenHash of listEnrollmentsOf(userId)) {
          enrollments.delete(tokenHash)
        }
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
    },

    createUser(user) {
      if (userIdByWallet.has(user.walletAddress)) {
        return Promise.reject(new WalletAlreadyRegisteredError())
      }
      if (user.email !== undefined && userIdByEmail.has(user.email)) {
        return Promise.reject(new EmailAlreadyRegisteredError())
      }
      users.set(user.id, structuredClone(user))
      userIdByWallet.set(user.walletAddress, user.id)
      if (user.email !== undefined) userIdByEmail.set(user.email, user.id)
      return Promise.resolve()
    },

    listUsers() {
      const items = [...users.values()]
        .map((user) => structuredClone(user))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return Promise.resolve(items)
    },

    updateUser(userId, changes, updatedAt) {
      const current = userOrThrow(userId)
      const nextWallet = changes.walletAddress ?? current.walletAddress
      if (nextWallet !== current.walletAddress) {
        const owner = userIdByWallet.get(nextWallet)
        if (owner !== undefined && owner !== userId) {
          return Promise.reject(new WalletAlreadyRegisteredError())
        }
      }
      const updated: User = {
        ...current,
        ...(changes.displayName !== undefined
          ? { displayName: changes.displayName }
          : {}),
        ...(changes.walletAddress !== undefined
          ? { walletAddress: changes.walletAddress }
          : {}),
        ...(changes.walletAssetCode !== undefined
          ? { walletAssetCode: changes.walletAssetCode }
          : {}),
        updatedAt
      }
      users.set(userId, structuredClone(updated))
      if (updated.walletAddress !== current.walletAddress) {
        userIdByWallet.delete(current.walletAddress)
        userIdByWallet.set(updated.walletAddress, userId)
      }
      return Promise.resolve(structuredClone(updated))
    },

    bumpSessionVersion(userId, updatedAt) {
      const current = userOrThrow(userId)
      const nextVersion = (current.sessionVersion ?? 0) + 1
      users.set(
        userId,
        structuredClone({
          ...current,
          sessionVersion: nextVersion,
          updatedAt
        })
      )
      return Promise.resolve(nextVersion)
    },

    addCredential(credential) {
      credentials.set(credential.id, structuredClone(credential))
      credentialIdsByUser.set(credential.userId, [
        ...listCredentialIds(credential.userId),
        credential.id
      ])
      return Promise.resolve()
    },

    deleteCredentials(userId, credentialIds) {
      const ownIds = listCredentialIds(userId)
      const toDelete =
        credentialIds === undefined
          ? ownIds
          : ownIds.filter((id) => credentialIds.includes(id))
      for (const id of toDelete) {
        credentials.delete(id)
      }
      const remaining = ownIds.filter((id) => !toDelete.includes(id))
      credentialIdsByUser.set(userId, remaining)
      return Promise.resolve(toDelete.length)
    },

    createEnrollment(enrollment) {
      enrollments.set(enrollment.tokenHash, structuredClone(enrollment))
      return Promise.resolve()
    },

    getEnrollment(tokenHash, nowSeconds) {
      const enrollment = enrollments.get(tokenHash)
      if (enrollment === undefined || enrollment.expiresAt <= nowSeconds) {
        return Promise.resolve(null)
      }
      return Promise.resolve(structuredClone(enrollment))
    },

    consumeEnrollment(tokenHash, nowSeconds) {
      const enrollment = enrollments.get(tokenHash)
      if (enrollment === undefined) return Promise.resolve(null)
      enrollments.delete(tokenHash)
      if (enrollment.expiresAt <= nowSeconds) return Promise.resolve(null)
      return Promise.resolve(structuredClone(enrollment))
    },

    deleteEnrollments(userId) {
      for (const tokenHash of listEnrollmentsOf(userId)) {
        enrollments.delete(tokenHash)
      }
      return Promise.resolve()
    }
  }
}
