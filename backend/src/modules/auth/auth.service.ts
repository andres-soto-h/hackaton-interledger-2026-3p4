import { createHash } from 'node:crypto'
import type { OpenPaymentsGateway } from '../../integrations/open-payments/gateway.js'
import { AppError } from '../../shared/errors/app-error.js'
import type { ActivityEmitter } from '../../shared/activity/activity-emitter.js'
import { newChallengeId, newUserId } from '../../shared/ids/ids.js'
import { assertSafeWalletUrl } from '../../shared/security/wallet-url.js'
import type { SettingsProvider } from '../../shared/settings/settings-provider.js'
import type { Session, SessionService } from '../../shared/session/session.service.js'
import {
  PasskeyVerificationError,
  type PasskeyVerifier
} from '../../shared/webauthn/passkey-verifier.js'
import type { Credential, User } from '../users/user.types.js'
import {
  WalletAlreadyRegisteredError,
  type UsersRepository
} from '../users/users.repository.js'

const CHALLENGE_TTL_SECONDS = 300

export interface AuthDeps {
  users: UsersRepository
  verifier: PasskeyVerifier
  sessions: SessionService
  gateway: OpenPaymentsGateway
  settings: SettingsProvider
  webauthn: { rpID: string; rpName: string; origins: string[] }
  /**
   * When `true`, WebAuthn verification is skipped (register and login succeed
   * without a real passkey). For local testing only.
   */
  passkeyBypass?: boolean
  /** Milliseconds since the epoch. */
  now?: () => number
  /** Business activity emitter (spec 022); defaults to a no-op. */
  activity?: ActivityEmitter
}

export interface PublicUser {
  id: string
  displayName: string
  walletAddress: string
  createdAt: string
}

export interface AuthSession {
  user: PublicUser
  session: { token: string; expiresAt: string }
}

const walletAlreadyRegistered = (): AppError =>
  new AppError(409, 'WALLET_ALREADY_REGISTERED', 'Wallet address already registered')

const emailAlreadyRegistered = (): AppError =>
  new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'Email already registered')

const challengeExpired = (): AppError =>
  new AppError(400, 'CHALLENGE_EXPIRED', 'Challenge expired, used or invalid')

const passkeyFailed = (): AppError =>
  new AppError(400, 'PASSKEY_VERIFICATION_FAILED', 'Passkey verification failed')

const sessionInvalid = (): AppError =>
  new AppError(401, 'SESSION_INVALID', 'Invalid or expired session')

const publicUser = (user: User): PublicUser => ({
  id: user.id,
  displayName: user.displayName,
  walletAddress: user.walletAddress,
  createdAt: user.createdAt
})

const credentialIdOf = (credential: unknown): string | undefined =>
  typeof credential === 'object' && credential !== null
    ? ((credential as { id?: unknown }).id as string | undefined)
    : undefined

export interface AuthService {
  registerOptions(input: {
    displayName?: string
    email?: string
    walletAddress?: string
    enrollmentToken?: string
  }): Promise<{ challengeId: string; options: Record<string, unknown> }>
  registerVerify(input: {
    challengeId: string
    credential: unknown
  }): Promise<AuthSession>
  loginOptions(input?: {
    email?: string
  }): Promise<{ challengeId: string; options: Record<string, unknown> }>
  loginVerify(input: { challengeId: string; credential: unknown }): Promise<AuthSession>
}

export function createAuthService(deps: AuthDeps): AuthService {
  const { users, verifier, sessions, gateway, settings, webauthn } = deps
  const passkeyBypass = deps.passkeyBypass ?? false
  const emit: ActivityEmitter = deps.activity ?? (() => Promise.resolve())
  const nowMs = deps.now ?? Date.now
  const nowSeconds = (): number => Math.floor(nowMs() / 1000)
  const iso = (): string => new Date(nowMs()).toISOString()

  const issueSession = (user: User): Session =>
    sessions.issue(user.id, user.sessionVersion ?? 0)

  const registerOptionsWithEnrollment = async (
    enrollmentToken: string
  ): Promise<{ challengeId: string; options: Record<string, unknown> }> => {
    const tokenHash = createHash('sha256').update(enrollmentToken).digest('hex')
    const enrollment = await users.getEnrollment(tokenHash, nowSeconds())
    if (enrollment === null) throw challengeExpired()

    const user = await users.getUser(enrollment.userId)
    if (user === null || user.status !== 'ACTIVE') throw challengeExpired()

    const options = await verifier.createRegistrationOptions({
      rpID: webauthn.rpID,
      rpName: webauthn.rpName,
      userId: user.id,
      userName: user.displayName
    })

    const challengeId = newChallengeId(nowMs())
    await users.createChallenge({
      id: challengeId,
      challenge: options.challenge,
      type: 'register',
      pending: {
        userId: user.id,
        displayName: user.displayName,
        walletAddress: user.walletAddress,
        walletAssetCode: user.walletAssetCode,
        enrollmentTokenHash: tokenHash
      },
      expiresAt: nowSeconds() + CHALLENGE_TTL_SECONDS
    })

    return { challengeId, options }
  }

  return {
    async registerOptions(input) {
      if (input.enrollmentToken !== undefined) {
        return registerOptionsWithEnrollment(input.enrollmentToken)
      }

      const safeWalletUrl = assertSafeWalletUrl(
        input.walletAddress ?? '',
        await settings.getSettings()
      )
      const wallet = await gateway.getWalletAddress(safeWalletUrl)

      const existing = await users.findUserByWallet(wallet.id)
      if (existing !== null) throw walletAlreadyRegistered()

      if (input.email !== undefined && input.email !== '') {
        const byEmail = await users.findUserByEmail(input.email)
        if (byEmail !== null) throw emailAlreadyRegistered()
      }

      const userId = newUserId(nowMs())
      const options = await verifier.createRegistrationOptions({
        rpID: webauthn.rpID,
        rpName: webauthn.rpName,
        userId,
        userName: input.displayName ?? ''
      })

      const challengeId = newChallengeId(nowMs())
      await users.createChallenge({
        id: challengeId,
        challenge: options.challenge,
        type: 'register',
        pending: {
          userId,
          displayName: input.displayName ?? '',
          ...(input.email !== undefined && input.email !== ''
            ? { email: input.email }
            : {}),
          walletAddress: wallet.id,
          walletAssetCode: wallet.assetCode
        },
        expiresAt: nowSeconds() + CHALLENGE_TTL_SECONDS
      })

      return { challengeId, options }
    },

    async registerVerify(input) {
      const challenge = await users.consumeChallenge(input.challengeId, nowSeconds())
      if (
        challenge === null ||
        challenge.type !== 'register' ||
        challenge.pending === undefined
      ) {
        throw challengeExpired()
      }

      const pending = challenge.pending

      let verified
      if (passkeyBypass) {
        // Bypass: no WebAuthn. A synthetic credential keeps the account model
        // intact (one credential per user) so the rest of the app is unchanged.
        verified = {
          credentialId: `bypass_${pending.userId}`,
          publicKey: 'bypass',
          counter: 0,
          deviceType: 'multiDevice' as const,
          backedUp: false
        }
      } else {
        try {
          verified = await verifier.verifyRegistration({
            credential: input.credential,
            expectedChallenge: challenge.challenge,
            expectedOrigins: webauthn.origins,
            expectedRPID: webauthn.rpID
          })
        } catch (error) {
          if (error instanceof PasskeyVerificationError) throw passkeyFailed()
          throw error
        }
      }

      // Enrollment link: attach the passkey to the existing account.
      if (pending.enrollmentTokenHash !== undefined) {
        const enrollment = await users.consumeEnrollment(
          pending.enrollmentTokenHash,
          nowSeconds()
        )
        if (enrollment === null) throw challengeExpired()

        const credential: Credential = {
          id: verified.credentialId,
          userId: pending.userId,
          publicKey: verified.publicKey,
          counter: verified.counter,
          ...(verified.transports !== undefined
            ? { transports: verified.transports }
            : {}),
          deviceType: verified.deviceType,
          backedUp: verified.backedUp,
          createdAt: iso()
        }
        await users.addCredential(credential)

        const user = await users.getUser(pending.userId)
        if (user === null) throw challengeExpired()
        return { user: publicUser(user), session: issueSession(user) }
      }

      const user: User = {
        id: pending.userId,
        displayName: pending.displayName,
        ...(pending.email !== undefined ? { email: pending.email } : {}),
        walletAddress: pending.walletAddress,
        walletAssetCode: pending.walletAssetCode,
        status: 'ACTIVE',
        createdAt: iso(),
        updatedAt: iso()
      }
      const credential: Credential = {
        id: verified.credentialId,
        userId: pending.userId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        ...(verified.transports !== undefined ? { transports: verified.transports } : {}),
        deviceType: verified.deviceType,
        backedUp: verified.backedUp,
        createdAt: iso()
      }

      try {
        await users.createUserWithCredential(user, credential)
      } catch (error) {
        if (error instanceof WalletAlreadyRegisteredError) throw walletAlreadyRegistered()
        throw error
      }

      await emit({
        type: 'user.registered',
        message: 'User registered',
        data: { userId: user.id }
      })

      return { user: publicUser(user), session: issueSession(user) }
    },

    async loginOptions(input) {
      const email = input?.email?.trim().toLowerCase()
      // With an email, only that account's passkeys can answer; an unknown email
      // gets no hint and fails at verification (`loginUserId: ''` matches nobody).
      const account =
        email !== undefined && email !== '' ? await users.findUserByEmail(email) : null
      const credentials = account !== null ? await users.listCredentials(account.id) : []
      const options = await verifier.createAuthenticationOptions({
        rpID: webauthn.rpID,
        ...(credentials.length > 0
          ? {
              allowCredentials: credentials.map((c) => ({
                id: c.id,
                ...(c.transports !== undefined ? { transports: c.transports } : {})
              }))
            }
          : {})
      })
      const challengeId = newChallengeId(nowMs())
      await users.createChallenge({
        id: challengeId,
        challenge: options.challenge,
        type: 'login',
        ...(email !== undefined && email !== ''
          ? { loginUserId: account?.id ?? '' }
          : {}),
        expiresAt: nowSeconds() + CHALLENGE_TTL_SECONDS
      })
      return { challengeId, options }
    },

    async loginVerify(input) {
      const challenge = await users.consumeChallenge(input.challengeId, nowSeconds())
      if (challenge === null || challenge.type !== 'login') throw challengeExpired()

      if (passkeyBypass) {
        // Bypass: without a passkey there is no credential to identify the
        // user, so log in as the most recently registered active account.
        const accounts = await users.listUsers()
        const user = accounts.find(
          (account) =>
            account.status === 'ACTIVE' &&
            (challenge.loginUserId === undefined || account.id === challenge.loginUserId)
        )
        if (user === undefined) throw sessionInvalid()
        return { user: publicUser(user), session: issueSession(user) }
      }

      const credentialId = credentialIdOf(input.credential)
      if (typeof credentialId !== 'string' || credentialId.length === 0) {
        throw passkeyFailed()
      }

      const stored = await users.getCredential(credentialId)
      if (stored === null) throw passkeyFailed()

      let verified
      try {
        verified = await verifier.verifyAuthentication({
          credential: input.credential,
          expectedChallenge: challenge.challenge,
          expectedOrigins: webauthn.origins,
          expectedRPID: webauthn.rpID,
          stored: {
            publicKey: stored.publicKey,
            counter: stored.counter,
            ...(stored.transports !== undefined ? { transports: stored.transports } : {})
          }
        })
      } catch (error) {
        if (error instanceof PasskeyVerificationError) throw passkeyFailed()
        throw error
      }

      const newCounter = verified.newCounter
      // Synced passkeys (counter 0) pass; hardware-backed counters must advance.
      if (stored.counter > 0 || newCounter > 0) {
        if (newCounter <= stored.counter) throw passkeyFailed()
      }

      // A challenge issued for an email only accepts that account's passkeys.
      if (
        challenge.loginUserId !== undefined &&
        stored.userId !== challenge.loginUserId
      ) {
        throw passkeyFailed()
      }

      const user = await users.getUser(stored.userId)
      if (user === null || user.status !== 'ACTIVE') throw sessionInvalid()

      await users.updateCredentialUsage(credentialId, {
        counter: newCounter,
        lastUsedAt: iso()
      })

      return { user: publicUser(user), session: issueSession(user) }
    }
  }
}
