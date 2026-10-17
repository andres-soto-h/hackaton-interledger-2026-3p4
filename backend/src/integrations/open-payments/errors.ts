import { AppError } from '../../shared/errors/app-error.js'
import type { Logger } from '../../shared/logger.js'
import type { GatewayOperation } from './gateway.js'

const networkCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN'])

type SdkLikeError = Error & {
  status?: number
  code?: string
  cause?: { code?: string }
}

/**
 * Translates an Open Payments SDK or network error into an API error from the
 * catalog (spec 003). `AppError` passes through unchanged; the original detail
 * is logged once and never included in the message returned to the client.
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

  let result: AppError
  if (name === 'TimeoutError') {
    result = new AppError(504, 'OPEN_PAYMENTS_TIMEOUT', 'Open Payments request timed out')
  } else if (status === 404 && operation === 'getWalletAddress') {
    result = new AppError(422, 'WALLET_NOT_FOUND', 'Wallet address not found')
  } else if (operation === 'createQuote' && (status === 400 || status === 422)) {
    result = new AppError(422, 'QUOTE_FAILED', 'Could not quote the payment')
  } else if (code !== undefined && networkCodes.has(code)) {
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
