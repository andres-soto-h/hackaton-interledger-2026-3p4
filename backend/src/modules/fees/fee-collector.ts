import type { OpenPaymentsGateway } from '../../integrations/open-payments/gateway.js'
import type { Logger } from '../../shared/logger.js'
import type { FeeCollector } from '../payments/fee.js'
import type { Payment } from '../payments/payment.types.js'
import type { PaymentsRepository } from '../payments/payments.repository.js'
import type { WalletLinksService } from '../wallet-links/wallet-links.service.js'

const INCOMING_PAYMENT_TTL_MS = 3600_000

/** Converts a decimal string to minor units as a BigInt without a fixed scale. */
function decimalToMinor(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.')
  const scale = fraction.length
  const factor = 10n ** BigInt(scale)
  return BigInt(whole) * factor + BigInt(fraction.length > 0 ? fraction : '0')
}

/** Compares two decimal strings exactly, returning -1, 0 or 1. */
function compareDecimals(a: string, b: string): number {
  const [aWhole = '0', aFraction = ''] = a.split('.')
  const [bWhole = '0', bFraction = ''] = b.split('.')
  const scale = Math.max(aFraction.length, bFraction.length)
  const factor = 10n ** BigInt(scale)
  const aMinor =
    BigInt(aWhole) * factor +
    BigInt(aFraction.length > 0 ? aFraction.padEnd(scale, '0') : '0')
  const bMinor =
    BigInt(bWhole) * factor +
    BigInt(bFraction.length > 0 ? bFraction.padEnd(scale, '0') : '0')
  if (aMinor < bMinor) return -1
  if (aMinor > bMinor) return 1
  return 0
}

export interface FeeCollectorDeps {
  gateway: OpenPaymentsGateway
  payments: PaymentsRepository
  walletLinks: WalletLinksService
  platformWalletUrl: string
  /** Milliseconds since the epoch. */
  now: () => number
  logger?: Pick<Logger, 'warn'>
}

/**
 * Real `FeeCollector` (spec 024): settles the fee with a second outgoing payment
 * from the sender to the platform wallet, and tracks its `feeStatus`. It never
 * throws: a failure only marks the fee `FAILED` (retryable via `refresh`).
 */
export function createFeeCollector({
  gateway,
  payments,
  walletLinks,
  platformWalletUrl,
  now,
  logger
}: FeeCollectorDeps): FeeCollector {
  /** Creates the incoming payment, quote and outgoing payment for the fee. */
  const settle = async (
    payment: Payment
  ): Promise<{ incomingUrl: string; outgoingUrl: string }> => {
    const platform = await gateway.getWalletAddress(platformWalletUrl)
    const sender = await gateway.getWalletAddress(payment.senderWalletAddress)
    const incoming = await gateway.createIncomingPayment({
      wallet: platform,
      expiresAt: new Date(now() + INCOMING_PAYMENT_TTL_MS)
    })
    const quote = await gateway.createQuote({
      sender,
      receiver: incoming.id,
      debitAmount: payment.fee
    })
    const outgoing = await walletLinks.withToken(payment.walletLinkId, (accessToken) =>
      gateway.createOutgoingPayment({ sender, quoteId: quote.id, accessToken })
    )
    return { incomingUrl: incoming.id, outgoingUrl: outgoing.id }
  }

  const releaseFee = async (payment: Payment): Promise<void> => {
    try {
      await walletLinks.release(payment.walletLinkId, payment.fee)
    } catch (error) {
      logger?.warn(
        { paymentId: payment.id, err: error },
        'Failed to release the fee reservation'
      )
    }
  }

  const markFailed = async (payment: Payment, attempts: number): Promise<void> => {
    try {
      await payments.updatePayment(
        payment.id,
        { feeStatus: 'FAILED', feeAttempts: attempts },
        { expectedStatus: payment.status }
      )
    } catch (error) {
      logger?.warn({ paymentId: payment.id, err: error }, 'Failed to mark fee as failed')
    }
    await releaseFee(payment)
  }

  const collect = async (payment: Payment): Promise<void> => {
    if (decimalToMinor(payment.fee.value) === 0n) return

    const attempts = (payment.feeAttempts ?? 0) + 1
    try {
      const { incomingUrl, outgoingUrl } = await settle(payment)
      await payments.updatePayment(
        payment.id,
        {
          feeStatus: 'PROCESSING',
          feeIncomingPaymentUrl: incomingUrl,
          feeOutgoingPaymentUrl: outgoingUrl,
          feeAttempts: attempts
        },
        { expectedStatus: payment.status }
      )
    } catch (error) {
      logger?.warn({ paymentId: payment.id, err: error }, 'Fee collection failed')
      await markFailed(payment, attempts)
    }
  }

  const refresh = async (payment: Payment): Promise<Payment> => {
    const attempts = payment.feeAttempts ?? 0

    if (
      payment.feeStatus === 'PROCESSING' &&
      payment.feeOutgoingPaymentUrl !== undefined
    ) {
      try {
        const outgoing = await walletLinks.withToken(
          payment.walletLinkId,
          (accessToken) =>
            gateway.getOutgoingPayment({
              url: payment.feeOutgoingPaymentUrl as string,
              accessToken
            })
        )
        if (outgoing.failed) {
          try {
            await payments.updatePayment(
              payment.id,
              { feeStatus: 'FAILED' },
              { expectedStatus: payment.status }
            )
          } catch (error) {
            logger?.warn(
              { paymentId: payment.id, err: error },
              'Failed to mark fee as failed'
            )
          }
          await releaseFee(payment)
        } else if (
          compareDecimals(outgoing.sentAmount.value, outgoing.debitAmount.value) >= 0
        ) {
          try {
            await payments.updatePayment(
              payment.id,
              { feeStatus: 'COLLECTED' },
              { expectedStatus: payment.status }
            )
          } catch (error) {
            logger?.warn(
              { paymentId: payment.id, err: error },
              'Failed to mark fee as collected'
            )
          }
        }
      } catch (error) {
        logger?.warn({ paymentId: payment.id, err: error }, 'Fee refresh failed')
      }
      return (await payments.getPayment(payment.id)) ?? payment
    }

    if (payment.feeStatus === 'FAILED' && attempts < 2) {
      try {
        await walletLinks.reserve(payment.walletLinkId, payment.fee)
      } catch (error) {
        logger?.warn(
          { paymentId: payment.id, err: error },
          'Fee retry reservation failed'
        )
        await markFailed(payment, attempts + 1)
        return (await payments.getPayment(payment.id)) ?? payment
      }

      const nextAttempts = attempts + 1
      try {
        const { incomingUrl, outgoingUrl } = await settle(payment)
        await payments.updatePayment(
          payment.id,
          {
            feeStatus: 'PROCESSING',
            feeIncomingPaymentUrl: incomingUrl,
            feeOutgoingPaymentUrl: outgoingUrl,
            feeAttempts: nextAttempts
          },
          { expectedStatus: payment.status }
        )
      } catch (error) {
        logger?.warn({ paymentId: payment.id, err: error }, 'Fee retry failed')
        await markFailed(payment, nextAttempts)
      }
      return (await payments.getPayment(payment.id)) ?? payment
    }

    return (await payments.getPayment(payment.id)) ?? payment
  }

  return { collect, refresh }
}
