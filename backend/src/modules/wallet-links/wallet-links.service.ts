import { randomUUID } from 'node:crypto'
import type { OpenPaymentsGateway } from '../../integrations/open-payments/gateway.js'
import { AppError } from '../../shared/errors/app-error.js'
import type { ActivityEmitter } from '../../shared/activity/activity-emitter.js'
import { newWalletLinkId } from '../../shared/ids/ids.js'
import type { Logger } from '../../shared/logger.js'
import { fromMinorUnits, toMinorUnits } from '../../shared/money/money.js'
import type { Amount } from '../../shared/money/types.js'
import type { TokenCipher } from '../../shared/security/token-cipher.js'
import { ConflictError } from '../payments/payments.repository.js'
import type { User } from '../users/user.types.js'
import { currentPeriod, dailyInterval } from './allowance-period.js'
import { verifyCallbackHash } from './callback-hash.js'
import type { DailyLimitProvider } from './daily-limit.provider.js'
import type { WalletLink, WalletLinkStatus } from './wallet-link.types.js'
import type { WalletLinksRepository } from './wallet-links.repository.js'

export interface WalletLinkStartResult {
  linkId: string
  authorizationUrl: string
  dailyLimit: Amount
  expiresAt: string
}

export interface WalletLinkStatusResult {
  linkId: string
  status: WalletLinkStatus
  isFinal: boolean
  walletVerified: boolean
  dailyLimit: Amount
}

export interface CallbackResult {
  linkId: string
  status: 'ACTIVE' | 'REJECTED'
}

export interface AllowanceResult {
  dailyLimit: Amount
  spent: Amount
  available: Amount
  periodStart: string
  periodEnd: string
}

export interface WalletLinksService {
  start(user: User): Promise<WalletLinkStartResult>
  getLatest(userId: string): Promise<WalletLinkStatusResult>
  handleCallback(input: {
    linkId: string
    interactRef?: string
    hash?: string
    result?: string
  }): Promise<CallbackResult>
  getUsableToken(linkId: string): Promise<string>
  withToken<T>(linkId: string, fn: (accessToken: string) => Promise<T>): Promise<T>
  reserve(linkId: string, amount: Amount): Promise<void>
  release(linkId: string, amount: Amount): Promise<void>
  getAllowance(userId: string): Promise<AllowanceResult>
  unlink(userId: string): Promise<void>
  revokeForUser(userId: string): Promise<void>
}

export interface WalletLinksServiceDeps {
  links: WalletLinksRepository
  gateway: OpenPaymentsGateway
  cipher: TokenCipher
  dailyLimits: DailyLimitProvider
  apiBaseUrl: string
  now: () => number
  linkAuthTtlSeconds?: number
  timezone?: string
  tokenRefreshWindowSeconds?: number
  logger?: Pick<Logger, 'warn'>
  /** Business activity emitter (spec 022); defaults to a no-op. */
  activity?: ActivityEmitter
}

export function createWalletLinksService({
  links,
  gateway,
  cipher,
  dailyLimits,
  apiBaseUrl,
  now,
  linkAuthTtlSeconds = 600,
  timezone = 'America/Bogota',
  tokenRefreshWindowSeconds = 60,
  logger,
  activity
}: WalletLinksServiceDeps): WalletLinksService {
  const nowIso = (): string => new Date(now()).toISOString()
  const emit: ActivityEmitter = activity ?? (() => Promise.resolve())

  const toStatusResult = (link: WalletLink): WalletLinkStatusResult => ({
    linkId: link.id,
    status: link.status === 'AUTHORIZING' ? 'PENDING_AUTHORIZATION' : link.status,
    isFinal: link.status !== 'PENDING_AUTHORIZATION' && link.status !== 'AUTHORIZING',
    walletVerified: link.status === 'ACTIVE',
    dailyLimit: { value: link.dailyLimit, assetCode: link.assetCode }
  })

  const requireActiveLink = async (linkId: string): Promise<WalletLink> => {
    const link = await links.get(linkId)
    if (link === null || link.status !== 'ACTIVE') {
      throw new AppError(403, 'WALLET_NOT_LINKED', 'Wallet is not linked')
    }
    return link
  }

  const decryptToken = (link: WalletLink): { accessToken: string; manageUrl: string } => {
    if (link.tokenCiphertext === undefined) {
      throw new AppError(403, 'WALLET_NOT_LINKED', 'Wallet is not linked')
    }
    const parsed = JSON.parse(cipher.decrypt(link.tokenCiphertext, link.id)) as {
      accessToken?: string
      manageUrl?: string
    }
    if (parsed.accessToken === undefined) {
      throw new AppError(403, 'WALLET_NOT_LINKED', 'Wallet is not linked')
    }
    return { accessToken: parsed.accessToken, manageUrl: parsed.manageUrl ?? '' }
  }

  const revoke = async (link: WalletLink): Promise<void> => {
    try {
      await gateway.cancelGrant({
        continueUri: link.continueUri,
        continueToken: link.continueToken
      })
    } catch (error) {
      logger?.warn({ linkId: link.id, err: error }, 'Failed to cancel the grant')
    }
    await links.update(link.id, {
      status: 'REVOKED',
      revokedAt: nowIso(),
      tokenCiphertext: undefined
    })
    await emit({
      type: 'wallet_link.revoked',
      level: 'warn',
      message: 'Wallet link revoked'
    })
  }

  /** In-flight rotations per link, so parallel callers rotate only once. */
  const rotations = new Map<string, Promise<string>>()

  const rotate = async (linkId: string): Promise<string> => {
    const link = await requireActiveLink(linkId)
    const { accessToken, manageUrl } = decryptToken(link)

    let rotated
    try {
      rotated = await gateway.rotateToken({ manageUrl, accessToken })
    } catch (error) {
      if (error instanceof AppError && error.code === 'GRANT_REVOKED') {
        await links.update(linkId, {
          status: 'REVOKED',
          revokedAt: nowIso(),
          tokenCiphertext: undefined
        })
        throw new AppError(409, 'WALLET_LINK_REVOKED', 'Wallet link was revoked')
      }
      throw error
    }

    const tokenCiphertext = cipher.encrypt(
      JSON.stringify({ accessToken: rotated.accessToken, manageUrl: rotated.manageUrl }),
      linkId
    )
    const changes: Partial<WalletLink> = {
      tokenCiphertext,
      tokenVersion: link.tokenVersion + 1
    }
    if (rotated.expiresAt !== undefined) {
      changes.tokenExpiresAt = rotated.expiresAt.toISOString()
    }

    try {
      await links.update(linkId, changes, { expectedTokenVersion: link.tokenVersion })
    } catch (error) {
      if (error instanceof ConflictError) {
        const fresh = await links.get(linkId)
        if (fresh !== null) return decryptToken(fresh).accessToken
      }
      throw error
    }
    await emit({
      type: 'wallet_link.token_rotated',
      message: 'Wallet link token rotated'
    })
    return rotated.accessToken
  }

  const getUsableToken = async (linkId: string): Promise<string> => {
    const link = await requireActiveLink(linkId)
    const { accessToken } = decryptToken(link)

    const expiresMs =
      link.tokenExpiresAt === undefined ? undefined : Date.parse(link.tokenExpiresAt)
    const nearExpiry =
      expiresMs !== undefined && expiresMs - now() <= tokenRefreshWindowSeconds * 1000

    if (!nearExpiry) return accessToken

    const existing = rotations.get(linkId)
    if (existing !== undefined) return existing

    const promise = rotate(linkId)
    rotations.set(linkId, promise)
    try {
      return await promise
    } finally {
      rotations.delete(linkId)
    }
  }

  return {
    async start(user) {
      const active = await links.findActiveByUser(user.id)
      if (active !== null) {
        throw new AppError(409, 'WALLET_ALREADY_LINKED', 'Wallet is already linked')
      }

      const wallet = await gateway.getWalletAddress(user.walletAddress)
      const limit = await dailyLimits.getDailyLimit(wallet.assetCode)
      if (limit === null) {
        throw new AppError(422, 'CURRENCY_NOT_SUPPORTED', 'Currency is not supported')
      }

      const linkId = newWalletLinkId(now())
      const period = currentPeriod(new Date(now()), timezone)
      const limits = {
        debitAmount: { value: limit, assetCode: wallet.assetCode },
        interval: dailyInterval(period.start)
      }
      const finishUri = `${apiBaseUrl}/api/v1/auth/callback?linkId=${linkId}`
      const clientNonce = randomUUID()

      const pending = await gateway.requestOutgoingPaymentGrant({
        sender: wallet,
        limits,
        finishUri,
        clientNonce
      })

      const authorizationExpiresAt = nowIsoFrom(now() + linkAuthTtlSeconds * 1000)
      const link: WalletLink = {
        id: linkId,
        userId: user.id,
        walletAddress: user.walletAddress,
        assetCode: wallet.assetCode,
        assetScale: wallet.assetScale,
        dailyLimit: limit,
        interval: limits.interval,
        periodTimezone: timezone,
        status: 'PENDING_AUTHORIZATION',
        authorization: {
          clientNonce,
          finishNonce: pending.finishNonce,
          authServerUrl: wallet.authServer,
          expiresAt: authorizationExpiresAt
        },
        continueUri: pending.continueUri,
        continueToken: pending.continueToken,
        tokenVersion: 0,
        createdAt: nowIso()
      }
      await links.create(link)

      await emit({
        type: 'wallet_link.requested',
        message: 'Wallet link requested',
        data: { walletAddress: link.walletAddress }
      })

      return {
        linkId,
        authorizationUrl: pending.interactRedirectUrl,
        dailyLimit: { value: limit, assetCode: wallet.assetCode },
        expiresAt: authorizationExpiresAt
      }
    },

    async getLatest(userId) {
      const link = await links.findLatestByUser(userId)
      if (link === null)
        throw new AppError(404, 'LINK_NOT_FOUND', 'Wallet link not found')
      return toStatusResult(link)
    },

    async handleCallback({ linkId, interactRef, hash, result }) {
      const link = await links.get(linkId)
      if (link === null)
        throw new AppError(404, 'LINK_NOT_FOUND', 'Wallet link not found')

      if (link.status !== 'PENDING_AUTHORIZATION') {
        await emit({
          type: 'wallet_link.callback_invalid',
          level: 'warn',
          message: 'Wallet link callback invalid',
          data: { reason: 'callback_repeated' }
        })
        throw new AppError(409, 'CALLBACK_ALREADY_USED', 'Callback was already used')
      }

      const authorization = link.authorization
      if (authorization === undefined || Date.parse(authorization.expiresAt) < now()) {
        await links.update(linkId, { status: 'EXPIRED' })
        await emit({
          type: 'wallet_link.expired',
          level: 'warn',
          message: 'Wallet link authorization expired'
        })
        throw new AppError(410, 'AUTHORIZATION_EXPIRED', 'Authorization expired')
      }

      if (result === 'grant_rejected') {
        await links.update(linkId, { status: 'REJECTED' })
        await emit({
          type: 'wallet_link.rejected',
          level: 'warn',
          message: 'Wallet link rejected',
          data: { reason: 'grant_rejected' }
        })
        return { linkId, status: 'REJECTED' }
      }

      if (interactRef === undefined || hash === undefined) {
        await emit({
          type: 'wallet_link.callback_invalid',
          level: 'warn',
          message: 'Wallet link callback invalid',
          data: { reason: 'invalid_callback' }
        })
        throw new AppError(400, 'CALLBACK_INVALID', 'Invalid callback')
      }

      const valid = verifyCallbackHash(
        {
          clientNonce: authorization.clientNonce,
          finishNonce: authorization.finishNonce,
          interactRef,
          authServerUrl: authorization.authServerUrl
        },
        hash
      )
      if (!valid) {
        await emit({
          type: 'wallet_link.callback_invalid',
          level: 'warn',
          message: 'Wallet link callback invalid',
          data: { reason: 'hash_mismatch' }
        })
        throw new AppError(400, 'CALLBACK_INVALID', 'Invalid callback')
      }

      try {
        await links.update(
          linkId,
          { status: 'AUTHORIZING' },
          { expectedStatus: 'PENDING_AUTHORIZATION' }
        )
      } catch (error) {
        if (error instanceof ConflictError) {
          await emit({
            type: 'wallet_link.callback_invalid',
            level: 'warn',
            message: 'Wallet link callback invalid',
            data: { reason: 'callback_repeated' }
          })
          throw new AppError(409, 'CALLBACK_ALREADY_USED', 'Callback was already used')
        }
        throw error
      }

      await emit({
        type: 'wallet_link.callback_received',
        message: 'Wallet link callback received',
        data: { walletAddress: link.walletAddress }
      })

      let grantResult
      try {
        grantResult = await gateway.continueGrant({
          continueUri: link.continueUri,
          continueToken: link.continueToken,
          interactRef
        })
      } catch (error) {
        if (error instanceof AppError && error.code === 'GRANT_NOT_FINALIZED') {
          await links.update(linkId, { status: 'REJECTED' })
          await emit({
            type: 'wallet_link.rejected',
            level: 'warn',
            message: 'Wallet link rejected',
            data: { reason: 'grant_not_finalized' }
          })
        }
        throw error
      }

      const requested = {
        debitAmount: { value: link.dailyLimit, assetCode: link.assetCode },
        interval: link.interval
      }
      const granted = grantResult.grantedLimits
      const limitsMatch =
        granted !== undefined &&
        granted.debitAmount.value === requested.debitAmount.value &&
        granted.debitAmount.assetCode === requested.debitAmount.assetCode &&
        granted.interval === requested.interval

      if (!limitsMatch) {
        await gateway.cancelGrant({
          continueUri: link.continueUri,
          continueToken: link.continueToken
        })
        await links.update(linkId, { status: 'REJECTED' })
        await emit({
          type: 'wallet_link.rejected',
          level: 'warn',
          message: 'Wallet link rejected',
          data: { reason: 'limits_mismatch' }
        })
        throw new AppError(409, 'GRANT_LIMITS_MISMATCH', 'Grant limits do not match')
      }

      const tokenCiphertext = cipher.encrypt(
        JSON.stringify({
          accessToken: grantResult.accessToken,
          manageUrl: grantResult.manageUrl
        }),
        linkId
      )

      await links.update(linkId, {
        status: 'ACTIVE',
        authorization: undefined,
        tokenCiphertext,
        tokenVersion: 1,
        ...(grantResult.expiresAt !== undefined
          ? { tokenExpiresAt: grantResult.expiresAt.toISOString() }
          : {}),
        authorizedAt: nowIso()
      })

      await emit({
        type: 'wallet_link.active',
        message: 'Wallet link active',
        data: { walletAddress: link.walletAddress }
      })

      return { linkId, status: 'ACTIVE' }
    },

    async getUsableToken(linkId) {
      return getUsableToken(linkId)
    },

    async withToken(linkId, fn) {
      const token = await getUsableToken(linkId)
      try {
        return await fn(token)
      } catch (error) {
        if (error instanceof AppError && error.code === 'OPEN_PAYMENTS_UNAUTHORIZED') {
          const fresh = await rotate(linkId)
          return await fn(fresh)
        }
        throw error
      }
    },

    async reserve(linkId, amount) {
      const link = await requireActiveLink(linkId)
      if (amount.assetCode !== link.assetCode) {
        throw new AppError(422, 'CURRENCY_NOT_SUPPORTED', 'Currency is not supported')
      }
      const period = currentPeriod(new Date(now()), timezone)
      const limitMinor = toMinorUnits(link.dailyLimit, link.assetScale)
      const amountMinor = toMinorUnits(amount.value, link.assetScale)
      const result = await links.reserve({
        linkId,
        periodStart: period.start.toISOString(),
        amount: amountMinor,
        limit: limitMinor
      })
      if (!result.ok) {
        throw new AppError(422, 'DAILY_LIMIT_EXCEEDED', 'Daily limit exceeded')
      }
    },

    async release(linkId, amount) {
      const link = await requireActiveLink(linkId)
      if (amount.assetCode !== link.assetCode) {
        throw new AppError(422, 'CURRENCY_NOT_SUPPORTED', 'Currency is not supported')
      }
      const period = currentPeriod(new Date(now()), timezone)
      const amountMinor = toMinorUnits(amount.value, link.assetScale)
      await links.release({
        linkId,
        periodStart: period.start.toISOString(),
        amount: amountMinor
      })
    },

    async getAllowance(userId) {
      const link = await links.findActiveByUser(userId)
      if (link === null)
        throw new AppError(403, 'WALLET_NOT_LINKED', 'Wallet is not linked')

      const period = currentPeriod(new Date(now()), timezone)
      const spentMinor = await links.getSpent(link.id, period.start.toISOString())
      const limitMinor = BigInt(toMinorUnits(link.dailyLimit, link.assetScale))
      const spent = BigInt(spentMinor)
      const availableMinor = limitMinor - spent
      const available = availableMinor < 0n ? '0' : availableMinor.toString()

      return {
        dailyLimit: { value: link.dailyLimit, assetCode: link.assetCode },
        spent: {
          value: fromMinorUnits(spentMinor, link.assetScale),
          assetCode: link.assetCode
        },
        available: {
          value: fromMinorUnits(available, link.assetScale),
          assetCode: link.assetCode
        },
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString()
      }
    },

    async unlink(userId) {
      const link = await links.findActiveByUser(userId)
      if (link === null)
        throw new AppError(404, 'LINK_NOT_FOUND', 'Wallet link not found')
      await revoke(link)
    },

    async revokeForUser(userId) {
      const active = await links.findActiveByUser(userId)
      if (active !== null) {
        await revoke(active)
        return
      }
      // Spec 027: also cancel a pending grant so deleting the account leaves no
      // orphan authorization in the wallet.
      const pending = await links.findLatestByUser(userId)
      if (
        pending !== null &&
        (pending.status === 'PENDING_AUTHORIZATION' || pending.status === 'AUTHORIZING')
      ) {
        await revoke(pending)
      }
    }
  }

  function nowIsoFrom(ms: number): string {
    return new Date(ms).toISOString()
  }
}
