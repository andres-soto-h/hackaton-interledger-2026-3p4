import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Caso de la tarea 4: el contrato OpenAPI describe el endpoint (comprobación ligera, sin parser YAML).
describe('openapi.yaml', () => {
  const doc = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')

  it('declara OpenAPI 3.x y el endpoint POST /api/v1/payment-requests', () => {
    expect(doc).toMatch(/^openapi: 3\./m)
    expect(doc).toMatch(/\/api\/v1\/payment-requests:\s*\n\s+post:/)
  })

  it('documenta la API key, la Idempotency-Key y las respuestas 201, 400, 401, 409 y 422', () => {
    expect(doc).toContain('x-api-key')
    expect(doc).toContain('Idempotency-Key')
    for (const status of ['201', '400', '401', '409', '422']) {
      expect(doc).toMatch(new RegExp(`['"]?${status}['"]?:`))
    }
  })

  it('documenta los códigos de error del endpoint', () => {
    for (const code of [
      'ASSET_MISMATCH',
      'WALLET_NOT_FOUND',
      'WALLET_NOT_ALLOWED',
      'VALIDATION_ERROR'
    ]) {
      expect(doc).toContain(code)
    }
  })
})
