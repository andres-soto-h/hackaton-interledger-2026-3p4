import { describe, expect, it, vi } from 'vitest'
import { toApiError } from '../../src/integrations/open-payments/errors.js'
import { AppError } from '../../src/shared/errors/app-error.js'

const sdkError = (status: number) =>
  Object.assign(new Error('Secret detail from https://auth.internal/grant'), {
    name: 'OpenPaymentsClientError',
    status,
    description: 'Secret detail from https://auth.internal/grant'
  })

const networkError = (code: string) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })

const logger = () => ({ warn: vi.fn() })

describe('toApiError', () => {
  // Caso 7
  it.each([
    [
      '404 al obtener una wallet',
      sdkError(404),
      'getWalletAddress',
      422,
      'WALLET_NOT_FOUND'
    ],
    ['400 al crear un quote', sdkError(400), 'createQuote', 422, 'QUOTE_FAILED'],
    ['422 al crear un quote', sdkError(422), 'createQuote', 422, 'QUOTE_FAILED'],
    [
      'timeout',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      'getIncomingPayment',
      504,
      'OPEN_PAYMENTS_TIMEOUT'
    ],
    [
      'conexión rechazada',
      networkError('ECONNREFUSED'),
      'createIncomingPayment',
      503,
      'OPEN_PAYMENTS_UNAVAILABLE'
    ],
    [
      'DNS',
      networkError('ENOTFOUND'),
      'getWalletAddress',
      503,
      'OPEN_PAYMENTS_UNAVAILABLE'
    ],
    ['500 del SDK', sdkError(500), 'getWalletAddress', 502, 'OPEN_PAYMENTS_ERROR'],
    [
      '404 fuera de getWalletAddress',
      sdkError(404),
      'createQuote',
      502,
      'OPEN_PAYMENTS_ERROR'
    ],
    [
      '400 fuera de createQuote',
      sdkError(400),
      'createOutgoingPayment',
      502,
      'OPEN_PAYMENTS_ERROR'
    ],
    ['error desconocido', new Error('boom'), 'continueGrant', 502, 'OPEN_PAYMENTS_ERROR'],
    ['valor que no es Error', 'boom', 'rotateToken', 502, 'OPEN_PAYMENTS_ERROR']
  ] as const)('%s → %i %s', (_, error, operation, status, code) => {
    const result = toApiError(error, operation, logger())

    expect(result).toBeInstanceOf(AppError)
    expect(result).toMatchObject({ status, code })
  })

  it('no expone el detalle original en el mensaje, pero lo deja en el log', () => {
    const original = sdkError(500)
    const log = logger()

    const result = toApiError(original, 'getWalletAddress', log)

    expect(result.message).not.toContain('auth.internal')
    expect(result.message).not.toContain('Secret detail')
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.warn.mock.calls[0])).toContain('getWalletAddress')
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ err: original })
  })

  it('deja pasar sin cambios un AppError ya traducido', () => {
    const already = new AppError(422, 'WALLET_NOT_ALLOWED', 'Wallet address not allowed')
    expect(toApiError(already, 'getWalletAddress', logger())).toBe(already)
  })

  it('funciona sin logger', () => {
    expect(toApiError(sdkError(404), 'getWalletAddress')).toMatchObject({
      code: 'WALLET_NOT_FOUND'
    })
  })

  // Spec 023: tokens rechazados y grants revocados.
  it.each([['createOutgoingPayment'], ['getOutgoingPayment'], ['createQuote']] as const)(
    '401 al usar un token en %s → OPEN_PAYMENTS_UNAUTHORIZED',
    (operation) => {
      const result = toApiError(sdkError(401), operation)
      expect(result).toMatchObject({ status: 502, code: 'OPEN_PAYMENTS_UNAUTHORIZED' })
    }
  )

  it.each([401, 403, 404])(
    '%i al rotar el token → GRANT_REVOKED (409): el grant ya no existe',
    (status) => {
      const result = toApiError(sdkError(status), 'rotateToken')
      expect(result).toMatchObject({ status: 409, code: 'GRANT_REVOKED' })
    }
  )
})
