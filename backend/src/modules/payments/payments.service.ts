import type { Logger } from '../../shared/logger.js'
import type {
  OpenPaymentsGateway,
  WalletAddress
} from '../../integrations/open-payments/gateway.js'
import { toApiError } from '../../integrations/open-payments/errors.js'
import { AppError } from '../../shared/errors/app-error.js'
import { newChallengeId, newPaymentId } from '../../shared/ids/ids.js'
import {
  assertWithinLimit,
  exchangeRate,
  fromMinorUnits,
  resolveFixedAmount,
  toMinorUnits
} from '../../shared/money/money.js'
import type { Amount } from '../../shared/money/types.js'
import { assertSafeWalletUrl } from '../../shared/security/wallet-url.js'
import type { SettingsProvider } from '../../shared/settings/settings-provider.js'
import {
  PasskeyVerificationError,
  type PasskeyVerifier
} from '../../shared/webauthn/passkey-verifier.js'
import type { WalletLinksRepository } from '../wallet-links/wallet-links.repository.js'
import type { WalletLinksService } from '../wallet-links/wallet-links.service.js'
import type { User } from '../users/user.types.js'
import type { UsersRepository } from '../users/users.repository.js'
import type { FeeCalculator, FeeCollector } from './fee.js'
import type { Payment } from './payment.types.js'
import { ConflictError, type PaymentsRepository } from './payments.repository.js'
import type { CreatePaymentBody } from './payments.schema.js'

const CHALLENGE_TTL_SECONDS = 120
const INCOMING_PAYMENT_TTL_MS = 3600_000

export interface PaymentsServiceDeps {
  gateway: OpenPaymentsGateway
  payments: PaymentsRepository
  links: WalletLinksRepository
  walletLinks: WalletLinksService
  users: UsersRepository
  verifier: PasskeyVerifier
  settings: SettingsProvider
  fees: FeeCalculator
  feeCollector: FeeCollector
  webauthn: { rpID: string; origins: string[] }
  /** Milliseconds since the epoch. */
  now: () => number
  logger?: Pick<Logger, 'warn'>
}

export interface QuoteResponse {
  paymentId: string
  status: 'AWAITING_CONFIRMATION'
  confirmBy: string
  quote: {
    debitAmount: Amount
    receiveAmount: Amount
    exchangeRate: string
    fee: Amount & { percentage: string }
    totalDebit: Amount
  }
  allowance: { dailyLimit: Amount; availableAfter: Amount }
}

export interface ConfirmOptionsResponse {
  challengeId: string
  options: Record<string, unknown>
}

export interface ConfirmResponse {
  paymentId: string
  status: 'PROCESSING'
}

export interface PaymentsService {
  quote(user: User, body: CreatePaymentBody): Promise<QuoteResponse>
  confirmOptions(user: User, paymentId: string): Promise<ConfirmOptionsResponse>
  confirm(
    user: User,
    paymentId: string,
    input: { challengeId: string; credential: unknown }
  ): Promise<ConfirmResponse>
  cancel(user: User, paymentId: string): Promise<void>
}

const walletNotLinked = (): AppError =>
  new AppError(403, 'WALLET_NOT_LINKED', 'Wallet is not linked')

const paymentNotFound = (): AppError =>
  new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found')

const notPayable = (): AppError =>
  new AppError(422, 'INCOMING_PAYMENT_NOT_PAYABLE', 'Incoming payment is not payable')

const notConfirmable = (): AppError =>
  new AppError(409, 'PAYMENT_NOT_CONFIRMABLE', 'Payment is not awaiting confirmation')

const quoteExpired = (): AppError =>
  new AppError(410, 'QUOTE_EXPIRED', 'The quote expired')

const challengeExpired = (): AppError =>
  new AppError(400, 'CHALLENGE_EXPIRED', 'Challenge expired, used or invalid')

const passkeyFailed = (): AppError =>
  new AppError(400, 'PASSKEY_VERIFICATION_FAILED', 'Passkey verification failed')

const notCancellable = (): AppError =>
  new AppError(409, 'PAYMENT_NOT_CANCELLABLE', 'Payment is not cancellable')

const credentialIdOf = (credential: unknown): string | undefined =>
  typeof credential === 'object' && credential !== null
    ? ((credential as { id?: unknown }).id as string | undefined)
    : undefined

/** Resolves the active wallet link and its sender wallet for a user. */
async function resolveSender(
  gateway: OpenPaymentsGateway,
  links: WalletLinksRepository,
  user: User
): Promise<{ linkId: string; sender: WalletAddress }> {
  const link = await links.findActiveByUser(user.id)
  if (link === null) throw walletNotLinked()
  try {
    const sender = await gateway.getWalletAddress(link.walletAddress)
    return { linkId: link.id, sender }
  } catch (error) {
    throw error instanceof AppError ? error : toApiError(error, 'getWalletAddress')
  }
}

export function createPaymentsService(deps: PaymentsServiceDeps): PaymentsService {
  const {
    gateway,
    payments,
    links,
    walletLinks,
    users,
    verifier,
    settings,
    fees,
    feeCollector,
    webauthn,
    now,
    logger
  } = deps

  const nowSeconds = (): number => Math.floor(now() / 1000)
  const iso = (): string => new Date(now()).toISOString()
  const asApiError = (error: unknown, operation: keyof OpenPaymentsGateway): AppError =>
    error instanceof AppError ? error : toApiError(error, operation, logger)

  async function quote(user: User, body: CreatePaymentBody): Promise<QuoteResponse> {
    const { linkId, sender } = await resolveSender(gateway, links, user)
    const runtime = await settings.getSettings()

    let receiverWalletAddress: string
    let incomingPaymentUrl: string
    let fixedAmountSide: Payment['fixedAmountSide']
    let quoteId: string
    let debitAmount: Amount
    let receiveAmount: Amount
    let quoteExpiresAt: Date

    if (body.type === 'p2p') {
      const safeReceiverUrl = assertSafeWalletUrl(body.receiverWalletAddress, runtime)
      receiverWalletAddress = safeReceiverUrl

      let receiver: WalletAddress
      try {
        receiver = await gateway.getWalletAddress(safeReceiverUrl)
      } catch (error) {
        throw asApiError(error, 'getWalletAddress')
      }

      fixedAmountSide = resolveFixedAmount(body.amount, sender, receiver)

      let incomingId: string
      try {
        if (fixedAmountSide === 'receive') {
          const incoming = await gateway.createIncomingPayment({
            wallet: receiver,
            amount: body.amount,
            expiresAt: new Date(now() + INCOMING_PAYMENT_TTL_MS)
          })
          incomingId = incoming.id
        } else {
          const incoming = await gateway.createIncomingPayment({
            wallet: receiver,
            expiresAt: new Date(now() + INCOMING_PAYMENT_TTL_MS)
          })
          incomingId = incoming.id
        }
      } catch (error) {
        throw asApiError(error, 'createIncomingPayment')
      }

      try {
        const quoted =
          fixedAmountSide === 'receive'
            ? await gateway.createQuote({ sender, receiver: incomingId })
            : await gateway.createQuote({
                sender,
                receiver: incomingId,
                debitAmount: body.amount
              })
        quoteId = quoted.id
        debitAmount = quoted.debitAmount
        receiveAmount = quoted.receiveAmount
        quoteExpiresAt = quoted.expiresAt
      } catch (error) {
        throw asApiError(error, 'createQuote')
      }

      incomingPaymentUrl = incomingId
    } else {
      const safeUrl = assertSafeWalletUrl(body.incomingPaymentUrl, runtime)

      let incoming
      try {
        incoming = await gateway.getIncomingPayment(safeUrl)
      } catch (error) {
        throw asApiError(error, 'getIncomingPayment')
      }

      const expired =
        incoming.expiresAt !== undefined && incoming.expiresAt.getTime() < now()
      const hasNoAmount =
        incoming.incomingAmount === undefined && body.amount === undefined
      if (incoming.completed || expired || hasNoAmount) throw notPayable()

      receiverWalletAddress = incoming.walletAddress
      incomingPaymentUrl = incoming.id
      fixedAmountSide = incoming.incomingAmount !== undefined ? 'receive' : 'send'

      try {
        const quoted =
          incoming.incomingAmount !== undefined
            ? await gateway.createQuote({ sender, receiver: incoming.id })
            : await gateway.createQuote({
                sender,
                receiver: incoming.id,
                debitAmount: body.amount
              })
        quoteId = quoted.id
        debitAmount = quoted.debitAmount
        receiveAmount = quoted.receiveAmount
        quoteExpiresAt = quoted.expiresAt
      } catch (error) {
        throw asApiError(error, 'createQuote')
      }
    }

    assertWithinLimit(debitAmount, runtime.maxPaymentAmounts)

    const { percentage, fee, totalDebit } = await fees.calculate(debitAmount)

    const allowance = await walletLinks.getAllowance(user.id)
    const link = await links.findActiveByUser(user.id)
    if (link === null) throw walletNotLinked()

    const totalMinor = BigInt(toMinorUnits(totalDebit.value, link.assetScale))
    const availableMinor = BigInt(
      toMinorUnits(allowance.available.value, link.assetScale)
    )
    if (totalMinor > availableMinor) {
      throw new AppError(422, 'DAILY_LIMIT_EXCEEDED', 'Daily limit exceeded')
    }

    const availableAfterMinor = availableMinor - totalMinor
    const paymentId = newPaymentId(now())
    const createdAt = iso()

    const payment: Payment = {
      id: paymentId,
      userId: user.id,
      walletLinkId: linkId,
      type: body.type,
      senderWalletAddress: sender.id,
      receiverWalletAddress,
      incomingPaymentUrl,
      fixedAmountSide,
      quote: {
        id: quoteId,
        debitAmount,
        receiveAmount,
        expiresAt: quoteExpiresAt.toISOString()
      },
      feePercentage: percentage,
      fee,
      totalDebit,
      feeStatus: 'NONE',
      status: 'AWAITING_CONFIRMATION',
      ...(body.description !== undefined ? { description: body.description } : {}),
      createdAt,
      updatedAt: createdAt,
      expiresAt: Math.floor(quoteExpiresAt.getTime() / 1000)
    }
    await payments.createPayment(payment)

    return {
      paymentId,
      status: 'AWAITING_CONFIRMATION',
      confirmBy: quoteExpiresAt.toISOString(),
      quote: {
        debitAmount,
        receiveAmount,
        exchangeRate: exchangeRate(debitAmount, receiveAmount),
        fee: { value: fee.value, assetCode: fee.assetCode, percentage },
        totalDebit
      },
      allowance: {
        dailyLimit: allowance.dailyLimit,
        availableAfter: {
          value: fromMinorUnits(availableAfterMinor.toString(), link.assetScale),
          assetCode: link.assetCode
        }
      }
    }
  }

  async function confirmOptions(
    user: User,
    paymentId: string
  ): Promise<ConfirmOptionsResponse> {
    const payment = await payments.getPayment(paymentId)
    if (payment === null || payment.userId !== user.id) throw paymentNotFound()

    const quoteExpiresMs = Date.parse(payment.quote.expiresAt)
    if (quoteExpiresMs < now()) {
      if (payment.status === 'AWAITING_CONFIRMATION') {
        await payments.updatePayment(
          paymentId,
          { status: 'EXPIRED' },
          { expectedStatus: 'AWAITING_CONFIRMATION' }
        )
      }
      throw quoteExpired()
    }

    if (payment.status !== 'AWAITING_CONFIRMATION') throw notConfirmable()

    const options = await verifier.createAuthenticationOptions({ rpID: webauthn.rpID })
    const credentials = await users.listCredentials(user.id)
    options.allowCredentials = credentials.map((credential) => ({
      id: credential.id,
      ...(credential.transports !== undefined
        ? { transports: credential.transports }
        : {})
    }))
    options.userVerification = 'required'

    const challengeId = newChallengeId(now())
    const quoteExpiresSeconds = Math.floor(quoteExpiresMs / 1000)
    const expiresAt = Math.min(nowSeconds() + CHALLENGE_TTL_SECONDS, quoteExpiresSeconds)
    await users.createChallenge({
      id: challengeId,
      challenge: options.challenge,
      type: 'payment_confirmation',
      payment: { paymentId, userId: user.id, totalDebit: payment.totalDebit },
      expiresAt
    })

    return { challengeId, options }
  }

  async function confirm(
    user: User,
    paymentId: string,
    input: { challengeId: string; credential: unknown }
  ): Promise<ConfirmResponse> {
    const payment = await payments.getPayment(paymentId)
    if (payment === null || payment.userId !== user.id) throw paymentNotFound()

    const quoteExpiresMs = Date.parse(payment.quote.expiresAt)
    if (quoteExpiresMs < now() && payment.status === 'AWAITING_CONFIRMATION') {
      await payments.updatePayment(
        paymentId,
        { status: 'EXPIRED' },
        { expectedStatus: 'AWAITING_CONFIRMATION' }
      )
      throw quoteExpired()
    }

    const challenge = await users.consumeChallenge(input.challengeId, nowSeconds())
    if (
      challenge === null ||
      challenge.type !== 'payment_confirmation' ||
      challenge.payment === undefined ||
      challenge.payment.paymentId !== paymentId ||
      challenge.payment.userId !== user.id
    ) {
      throw challengeExpired()
    }

    const credentialId = credentialIdOf(input.credential)
    if (typeof credentialId !== 'string' || credentialId.length === 0)
      throw passkeyFailed()

    const stored = await users.getCredential(credentialId)
    if (stored === null || stored.userId !== user.id) throw passkeyFailed()

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
    await users.updateCredentialUsage(credentialId, {
      counter: newCounter,
      lastUsedAt: iso()
    })

    let taken: Payment
    try {
      taken = await payments.updatePayment(
        paymentId,
        { status: 'PROCESSING' },
        { expectedStatus: 'AWAITING_CONFIRMATION' }
      )
    } catch (error) {
      if (error instanceof ConflictError) throw notConfirmable()
      throw error
    }

    const quoteExpiresSeconds = Math.floor(Date.parse(taken.quote.expiresAt) / 1000)
    try {
      await walletLinks.reserve(taken.walletLinkId, taken.totalDebit)
    } catch (error) {
      if (error instanceof AppError && error.code === 'DAILY_LIMIT_EXCEEDED') {
        await payments.updatePayment(
          paymentId,
          { status: 'AWAITING_CONFIRMATION', expiresAt: quoteExpiresSeconds },
          { expectedStatus: 'PROCESSING' }
        )
      }
      throw error
    }

    await payments.updatePayment(
      paymentId,
      { reservedAmount: taken.totalDebit },
      { expectedStatus: 'PROCESSING' }
    )

    let sender: WalletAddress
    let outgoingId: string
    try {
      sender = await gateway.getWalletAddress(taken.senderWalletAddress)
      const outgoing = await walletLinks.withToken(taken.walletLinkId, (accessToken) =>
        gateway.createOutgoingPayment({
          sender,
          quoteId: taken.quote.id,
          accessToken,
          ...(taken.description !== undefined ? { description: taken.description } : {})
        })
      )
      outgoingId = outgoing.id
    } catch (error) {
      const apiError = asApiError(error, 'createOutgoingPayment')
      await payments.updatePayment(
        paymentId,
        { status: 'FAILED', error: { code: apiError.code, message: apiError.message } },
        { expectedStatus: 'PROCESSING' }
      )
      try {
        await walletLinks.release(taken.walletLinkId, taken.totalDebit)
      } catch (releaseError) {
        // A revoked link cannot be released; it does not change the payment outcome.
        logger?.warn(
          { paymentId, err: releaseError },
          'Failed to release the reservation'
        )
      }
      throw apiError
    }

    await payments.updatePayment(
      paymentId,
      { outgoingPaymentUrl: outgoingId },
      { expectedStatus: 'PROCESSING' }
    )

    void feeCollector.collect(taken).catch((error: unknown) => {
      logger?.warn({ paymentId, err: error }, 'Fee collection failed')
    })

    return { paymentId, status: 'PROCESSING' }
  }

  async function cancel(user: User, paymentId: string): Promise<void> {
    const payment = await payments.getPayment(paymentId)
    if (payment === null || payment.userId !== user.id) throw paymentNotFound()

    if (payment.status === 'AWAITING_CONFIRMATION') {
      await payments.updatePayment(
        paymentId,
        { status: 'CANCELLED' },
        { expectedStatus: 'AWAITING_CONFIRMATION' }
      )
      return
    }
    throw notCancellable()
  }

  return { quote, confirmOptions, confirm, cancel }
}
