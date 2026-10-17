import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tarea 8 del spec 007: el contrato describe cotizar, confirmar con passkey y cancelar (comprobación ligera, sin parser YAML).
describe('openapi.yaml · pagos', () => {
  const doc = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')

  const pathBlock = (path: string): string => {
    const escaped = path.replace(/[/{}]/g, '\\$&')
    const match = new RegExp(`^  ${escaped}:\\s*\\n((?:    .*\\n|\\n)+)`, 'm').exec(doc)
    expect(match, `path ${path}`).not.toBeNull()
    return match?.[1] ?? ''
  }

  it.each([
    ['/api/v1/payments', 'post'],
    ['/api/v1/payments/{id}/confirm/options', 'post'],
    ['/api/v1/payments/{id}/confirm', 'post'],
    ['/api/v1/payments/{id}/cancel', 'post']
  ])('documenta %s (%s)', (path, method) => {
    expect(pathBlock(path)).toMatch(new RegExp(`^    ${method}:`, 'm'))
  })

  it.each([
    '/api/v1/payments',
    '/api/v1/payments/{id}/confirm/options',
    '/api/v1/payments/{id}/confirm',
    '/api/v1/payments/{id}/cancel'
  ])('%s exige la sesión (BearerAuth), no la API key', (path) => {
    const block = pathBlock(path)
    expect(block).toContain('BearerAuth')
    expect(block).not.toContain('ApiKeyAuth')
  })

  it('cotizar acepta p2p y p2m, soporta Idempotency-Key y responde 201 con el desglose', () => {
    const block = pathBlock('/api/v1/payments')
    expect(block).toContain('IdempotencyKey')
    expect(block).toContain("'201'")
    expect(doc).toContain('CreatePaymentBody')
    for (const field of [
      'paymentId',
      'confirmBy',
      'exchangeRate',
      'totalDebit',
      'availableAfter'
    ]) {
      expect(doc, field).toContain(field)
    }
  })

  it('confirmar responde 202 con Retry-After y recibe challengeId y credential', () => {
    const block = pathBlock('/api/v1/payments/{id}/confirm')
    expect(block).toContain("'202'")
    expect(block).toContain('Retry-After')
    expect(doc).toContain('challengeId')
    expect(doc).toContain('credential')
  })

  it('cancelar responde 204', () => {
    expect(pathBlock('/api/v1/payments/{id}/cancel')).toContain("'204'")
  })

  it('documenta los códigos de error de los pagos', () => {
    for (const code of [
      'WALLET_NOT_LINKED',
      'PAYMENT_NOT_FOUND',
      'PAYMENT_NOT_CONFIRMABLE',
      'PAYMENT_NOT_CANCELLABLE',
      'QUOTE_EXPIRED',
      'DAILY_LIMIT_EXCEEDED',
      'ASSET_MISMATCH',
      'INCOMING_PAYMENT_NOT_PAYABLE',
      'PAYMENTS_DISABLED',
      'CHALLENGE_EXPIRED',
      'PASSKEY_VERIFICATION_FAILED'
    ]) {
      expect(doc, code).toContain(code)
    }
  })
})
