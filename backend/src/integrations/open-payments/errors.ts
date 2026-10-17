import { AppError } from '../../shared/errors/app-error.js'
import type { Logger } from '../../shared/logger.js'
import type { GatewayOperation } from './gateway.js'

const networkCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN'])

type SdkLikeError = Error & {
  status?: number
  code?: string
  description?: string
  cause?: { code?: string }
}

const isTimeoutError = (name: string | undefined, description: string): boolean =>
  name === 'TimeoutError' || /timed out/i.test(description)

const isNetworkError = (
  name: string | undefined,
  code: string | undefined,
  description: string
): boolean =>
  (code !== undefined && networkCodes.has(code)) ||
  name === 'TypeError' ||
  (name === 'OpenPaymentsClientError' && /fetch failed/i.test(description))

/**
 * Translates an Open Payments SDK or network error into an API error from the
 * catalog (spec 003). `AppError` passes through unchanged; the original detail
 * is logged once and never included in the message returned to the client.
 *
 * The SDK wraps transport failures into `OpenPaymentsClientError`, preserving
 * the reason in `description` (ky's "Request timed out", fetch's "fetch failed")
 * but dropping the original error name/code. Those are recovered here.
 */
export function toApiError(
  error: unknown,
  operation: GatewayOperation,
  logger?: Pick<Logger, 'warn'>
): AppError {
  if (error instanceof AppError) return error

  const err = error as SdkLikeError | null | undefined
  const name = err?.name
  const status = err?.status
  const code = err?.code ?? err?.cause?.code
  const description = err?.description ?? err?.message ?? ''

  let result: AppError
  if (isTimeoutError(name, description)) {
    result = new AppError(504, 'OPEN_PAYMENTS_TIMEOUT', 'Open Payments request timed out')
  } else if (status === 404 && operation === 'getWalletAddress') {
    result = new AppError(422, 'WALLET_NOT_FOUND', 'Wallet address not found')
  } else if (operation === 'createQuote' && (status === 400 || status === 422)) {
    result = new AppError(422, 'QUOTE_FAILED', 'Could not quote the payment')
  } else if (isNetworkError(name, code, description)) {
    result = new AppError(
      503,
      'OPEN_PAYMENTS_UNAVAILABLE',
      'Open Payments is unavailable'
    )
  } else {
    result = new AppError(502, 'OPEN_PAYMENTS_ERROR', 'Open Payments error')
  }

  logger?.warn({ err: error, operation }, 'Open Payments gateway error')
  return result
}
