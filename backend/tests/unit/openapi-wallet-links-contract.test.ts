import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tarea 9 del spec 023: el contrato describe la vinculación y el monto diario (comprobación ligera, sin parser YAML).
describe('openapi.yaml · vinculación de wallet y monto diario', () => {
  const doc = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')

  const pathBlock = (path: string): string => {
    const escaped = path.replace(/\//g, '\\/')
    const match = new RegExp(`^  ${escaped}:\\s*\\n((?:    .*\\n|\\n)+)`, 'm').exec(doc)
    expect(match, `path ${path}`).not.toBeNull()
    return match?.[1] ?? ''
  }

  it.each([
    ['/api/v1/me/wallet-link', 'post'],
    ['/api/v1/me/wallet-link', 'get'],
    ['/api/v1/me/wallet-link', 'delete'],
    ['/api/v1/me/allowance', 'get'],
    ['/api/v1/auth/callback', 'get']
  ])('documenta %s (%s)', (path, method) => {
    expect(pathBlock(path)).toMatch(new RegExp(`^    ${method}:`, 'm'))
  })

  it.each(['/api/v1/me/wallet-link', '/api/v1/me/allowance'])(
    '%s exige la sesión (BearerAuth)',
    (path) => {
      expect(pathBlock(path)).toContain('BearerAuth')
    }
  )

  it('el callback es público: no declara seguridad ni exige API key', () => {
    const block = pathBlock('/api/v1/auth/callback')
    expect(block).toMatch(/security:\s*\[\s*\]/)
    expect(block).toContain('interact_ref')
    expect(block).toContain('hash')
  })

  it('documenta el disponible del periodo', () => {
    const block = pathBlock('/api/v1/me/allowance')
    for (const field of ['dailyLimit', 'spent', 'available', 'periodStart']) {
      expect(doc, field).toContain(field)
    }
    expect(block).toContain('200')
  })

  it('documenta los códigos de error de la vinculación', () => {
    for (const code of [
      'WALLET_ALREADY_LINKED',
      'CURRENCY_NOT_SUPPORTED',
      'LINK_NOT_FOUND',
      'CALLBACK_INVALID',
      'CALLBACK_ALREADY_USED',
      'AUTHORIZATION_EXPIRED',
      'GRANT_LIMITS_MISMATCH',
      'WALLET_NOT_LINKED',
      'DAILY_LIMIT_EXCEEDED'
    ]) {
      expect(doc, code).toContain(code)
    }
  })

  it('mantiene los contratos anteriores (006 y 019)', () => {
    expect(doc).toMatch(/\/api\/v1\/payment-requests:\s*\n\s+post:/)
    expect(doc).toMatch(/\/api\/v1\/me:\s*\n\s+get:/)
  })
})
