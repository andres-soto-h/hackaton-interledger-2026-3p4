import type { OpenPaymentsGateway } from '../../integrations/open-payments/gateway.js'
import { AppError } from '../../shared/errors/app-error.js'
import type { Logger } from '../../shared/logger.js'
import { fromMinorUnits } from '../../shared/money/money.js'
import type { Amount } from '../../shared/money/types.js'
import type { WalletLinksService } from '../wallet-links/wallet-links.service.js'
import type { User } from '../users/user.types.js'
import type { FeeCollector } from './fee.js'
import type { FeeStatus, Payment, PaymentStatus, PaymentType } from './payment.types.js'
import { ConflictError, type PaymentsRepository } from './payments.repository.js'

export interface PaymentStatusResponse {
  paymentId: string
  type: PaymentType
  status: PaymentStatus
  isFinal: boolean
  senderWalletAddress: string
  receiverWalletAddress: string
  debitAmount: Amount
  receiveAmount: Amount
  sentAmount: Amount | null
  fee: Amount & { percentage: string }
  feeStatus: FeeStatus
  totalDebit: Amount
  description: string | null
  error: { code: string; message: string } | null
  /** Present only when the status could not be refreshed from Open Payments. */
  stale?: true
  createdAt: string
  updatedAt: string
}

export interface PaymentStatusService {
  getStatus(user: User, paymentId: string): Promise<PaymentStatusResponse>
  /** Refreshes a non-final payment; never throws for Open Payments failures. */
  refresh(payment: Payment): Promise<{ payment: Payment; stale: boolean }>
}

export interface PaymentStatusServiceDeps {
  payments: PaymentsRepository
  walletLinks: WalletLinksService
  gateway: OpenPaymentsGateway
  feeCollector: FeeCollector
  /** Milliseconds since the epoch. */
  now: () => number
  logger?: Pick<Logger, 'warn'>
}

const FINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
])

const paymentNotFound = (): AppError =>
  new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found')

/** Number of decimals of a decimal string (the amount's scale). */
const decimalPlaces = (value: string | undefined): number => {
  if (value === undefined) return 0
  const dot = value.indexOf('.')
  return dot === -1 ? 0 : value.length - dot - 1
}

const maxScale = (...values: (string | undefined)[]): number =>
  Math.max(0, ...values.map(decimalPlaces))

/**
 * Parses a decimal string into minor units at the given scale, with `BigInt`
 * only (never `Number`). Unlike `toMinorUnits`, it accepts `"0"` amounts.
 */
const minorAt = (value: string, scale: number): bigint => {
  const [whole = '0', fraction = ''] = value.split('.')
  const scaleFactor = 10n ** BigInt(scale)
  return (
    BigInt(whole) * scaleFactor +
    BigInt(fraction.length > 0 ? fraction.padEnd(scale, '0') : '0')
  )
}

export function createPaymentStatusService(
  deps: PaymentStatusServiceDeps
): PaymentStatusService {
  const { payments, walletLinks, gateway, now, logger } = deps

  const toResponse = (payment: Payment, stale?: boolean): PaymentStatusResponse => ({
    paymentId: payment.id,
    type: payment.type,
    status: payment.status,
    isFinal: FINAL_STATUSES.has(payment.status),
    senderWalletAddress: payment.senderWalletAddress,
    receiverWalletAddress: payment.receiverWalletAddress,
    debitAmount: payment.quote.debitAmount,
    receiveAmount: payment.quote.receiveAmount,
    sentAmount: payment.sentAmount ?? null,
    fee: {
      value: payment.fee.value,
      assetCode: payment.fee.assetCode,
      percentage: payment.feePercentage
    },
    feeStatus: payment.feeStatus,
    totalDebit: payment.totalDebit,
    description: payment.description ?? null,
    error: payment.error ?? null,
    ...(stale === true ? { stale: true } : {}),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt
  })

  /** Applies a transition; on conflict re-reads and returns the stored state. */
  const updateOrReread = async (
    payment: Payment,
    changes: Partial<Payment>,
    expectedStatus: PaymentStatus
  ): Promise<{ payment: Payment; updated: boolean }> => {
    try {
      const updated = await payments.updatePayment(payment.id, changes, {
        expectedStatus
      })
      return { payment: updated, updated: true }
    } catch (error) {
      if (error instanceof ConflictError) {
        const fresh = await payments.getPayment(payment.id)
        return { payment: fresh ?? payment, updated: false }
      }
      throw error
    }
  }

  const releaseQuietly = async (payment: Payment, amount: Amount): Promise<void> => {
    try {
      await walletLinks.release(payment.walletLinkId, amount)
    } catch (error) {
      logger?.warn(
        { paymentId: payment.id, err: error },
        'Failed to release the reservation'
      )
    }
  }

  /** The reserved amount not spent, or `null` when nothing is left over. */
  const unusedReservation = (payment: Payment): Amount | null => {
    const reserved = payment.reservedAmount ?? payment.totalDebit
    const scale = maxScale(reserved.value, payment.sentAmount?.value, payment.fee.value)
    const reservedMinor = minorAt(reserved.value, scale)
    const sentMinor = minorAt(payment.sentAmount?.value ?? '0', scale)
    const feeMinor = minorAt(payment.fee.value, scale)
    const unusedMinor = reservedMinor - (sentMinor + feeMinor)
    if (unusedMinor <= 0n) return null
    return {
      value: fromMinorUnits(unusedMinor.toString(), scale),
      assetCode: reserved.assetCode
    }
  }

  const sentReachedDebit = (sent: Amount, debit: Amount): boolean => {
    const scale = maxScale(sent.value, debit.value)
    return minorAt(sent.value, scale) >= minorAt(debit.value, scale)
  }

  async function refresh(
    payment: Payment
  ): Promise<{ payment: Payment; stale: boolean }> {
    if (FINAL_STATUSES.has(payment.status)) {
      return { payment, stale: false }
    }

    if (payment.status === 'AWAITING_CONFIRMATION') {
      if (Date.parse(payment.quote.expiresAt) <= now()) {
        const result = await updateOrReread(
          payment,
          { status: 'EXPIRED' },
          'AWAITING_CONFIRMATION'
        )
        return { payment: result.payment, stale: false }
      }
      return { payment, stale: false }
    }

    // PROCESSING: read the outgoing payment with the wallet link's token.
    try {
      const outgoing = await walletLinks.withToken(payment.walletLinkId, (token) =>
        gateway.getOutgoingPayment({
          url: payment.outgoingPaymentUrl ?? '',
          accessToken: token
        })
      )

      if (outgoing.failed) {
        // Nothing was sent → the wallet had no funds (or liquidity) for this
        // payment. Use a specific error so the app can explain it clearly.
        const nothingSent = !/[1-9]/.test(outgoing.sentAmount.value)
        const error = nothingSent
          ? { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' }
          : { code: 'OUTGOING_PAYMENT_FAILED', message: 'Outgoing payment failed' }
        const result = await updateOrReread(
          payment,
          {
            status: 'FAILED',
            error
          },
          'PROCESSING'
        )
        if (result.updated) {
          await releaseQuietly(
            result.payment,
            result.payment.reservedAmount ?? result.payment.totalDebit
          )
        }
        return { payment: result.payment, stale: false }
      }

      if (sentReachedDebit(outgoing.sentAmount, payment.quote.debitAmount)) {
        const result = await updateOrReread(
          payment,
          { status: 'COMPLETED', sentAmount: outgoing.sentAmount },
          'PROCESSING'
        )
        if (result.updated) {
          const unused = unusedReservation(result.payment)
          if (unused !== null) await releaseQuietly(result.payment, unused)
          if (result.payment.feeStatus === 'FAILED') {
            void deps.feeCollector.collect(result.payment).catch((error: unknown) => {
              logger?.warn(
                { paymentId: result.payment.id, err: error },
                'Fee collection retry failed'
              )
            })
          }
        }
        return { payment: result.payment, stale: false }
      }

      return { payment, stale: false }
    } catch (error) {
      logger?.warn(
        { paymentId: payment.id, err: error },
        'Failed to refresh payment status'
      )
      return { payment, stale: true }
    }
  }

  async function getStatus(
    user: User,
    paymentId: string
  ): Promise<PaymentStatusResponse> {
    const payment = await payments.getPayment(paymentId)
    if (payment === null || payment.userId !== user.id) throw paymentNotFound()
    const { payment: refreshed, stale } = await refresh(payment)
    return toResponse(refreshed, stale ? true : undefined)
  }

  return { getStatus, refresh }
}
