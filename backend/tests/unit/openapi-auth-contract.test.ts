import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tarea 7 del spec 019: el contrato describe cuentas y sesión (comprobación ligera, sin parser YAML).
describe('openapi.yaml · auth y me', () => {
  const doc = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')

  it.each([
    ['/api/v1/auth/register/options', 'post'],
    ['/api/v1/auth/register/verify', 'post'],
    ['/api/v1/auth/login/options', 'post'],
    ['/api/v1/auth/login/verify', 'post'],
    ['/api/v1/me', 'get'],
    ['/api/v1/me', 'delete']
  ])('documenta %s (%s)', (path, method) => {
    const escaped = path.replace(/\//g, '\\/')
    const pathBlock = new RegExp(`^  ${escaped}:\\s*\\n((?:    .*\\n|\\n)+)`, 'm').exec(
      doc
    )
    expect(pathBlock, `path ${path}`).not.toBeNull()
    expect(pathBlock?.[1]).toMatch(new RegExp(`^    ${method}:`, 'm'))
  })

  it('mantiene el endpoint de solicitar pago del spec 006', () => {
    expect(doc).toMatch(/\/api\/v1\/payment-requests:\s*\n\s+post:/)
  })

  it('declara el esquema de seguridad Bearer (sesión) además de la API key', () => {
    expect(doc).toMatch(/BearerAuth:\s*\n\s+type: http\s*\n\s+scheme: bearer/)
    expect(doc).toContain('x-api-key')
  })

  it('documenta los códigos de error de cuentas y sesión', () => {
    for (const code of [
      'WALLET_ALREADY_REGISTERED',
      'CHALLENGE_EXPIRED',
      'PASSKEY_VERIFICATION_FAILED',
      'SESSION_INVALID',
      'REAUTH_REQUIRED',
      'VALIDATION_ERROR'
    ]) {
      expect(doc, code).toContain(code)
    }
  })
})
