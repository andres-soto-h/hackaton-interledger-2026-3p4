import { AppError } from '../../shared/errors/app-error.js'
import type { OpenPaymentsGateway } from '../../integrations/open-payments/gateway.js'
import type { PaymentStatus } from '../payments/payment.types.js'

export type PaymentStatusCounts = Partial<Record<PaymentStatus, number>>

export interface PaymentsSummaryProvider {
  last24h(): Promise<PaymentStatusCounts>
}

export type OpenPaymentsStatus = { connected: true } | { connected: false; error: string }

export interface OpenPaymentsStatusChecker {
  check(): Promise<OpenPaymentsStatus>
}

export interface OpenPaymentsStatusCheckerOptions {
  gateway: OpenPaymentsGateway
  walletAddressUrl: string
  timeoutMs?: number
}

/**
 * Reports whether the configured wallet provider answers `getWalletAddress`.
 * Only the `AppError` code is exposed; unknown errors and timeouts get a
 * fixed code, so internal details never reach the admin page.
 */
export function createOpenPaymentsStatusChecker({
  gateway,
  walletAddressUrl,
  timeoutMs = 3000
}: OpenPaymentsStatusCheckerOptions): OpenPaymentsStatusChecker {
  return {
    check(): Promise<OpenPaymentsStatus> {
      return new Promise<OpenPaymentsStatus>((resolve) => {
        const timer = setTimeout(() => {
          resolve({ connected: false, error: 'OPEN_PAYMENTS_TIMEOUT' })
        }, timeoutMs)

        gateway
          .getWalletAddress(walletAddressUrl)
          .then(() => resolve({ connected: true }))
          .catch((error: unknown) => {
            if (error instanceof AppError) {
              resolve({ connected: false, error: error.code })
            } else {
              resolve({ connected: false, error: 'OPEN_PAYMENTS_ERROR' })
            }
          })
          .finally(() => clearTimeout(timer))
      })
    }
  }
}
