import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tarea 4 del spec 008: el contrato describe la consulta de un pago y el listado de transacciones (comprobación ligera, sin parser YAML).
describe('openapi.yaml · consulta de pagos y transacciones', () => {
  const doc = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')

  const pathBlock = (path: string): string => {
    const escaped = path.replace(/[/{}]/g, '\\$&')
    const match = new RegExp(`^  ${escaped}:\\s*\\n((?:    .*\\n|\\n)+)`, 'm').exec(doc)
    expect(match, `path ${path}`).not.toBeNull()
    return match?.[1] ?? ''
  }

  it.each(['/api/v1/payments/{id}', '/api/v1/transactions'])(
    '%s se consulta con GET y exige la sesión (BearerAuth), no la API key',
    (path) => {
      const block = pathBlock(path)
      expect(block).toMatch(/^ {4}get:/m)
      expect(block).toContain('BearerAuth')
      expect(block).not.toContain('ApiKeyAuth')
    }
  )

  it('el estado del pago documenta el refresco, stale y la comisión', () => {
    const block = pathBlock('/api/v1/payments/{id}')
    expect(block).toContain("'200'")
    expect(block).toContain("'404'")
    for (const field of ['sentAmount', 'feeStatus', 'totalDebit', 'stale']) {
      expect(doc, field).toContain(field)
    }
  })

  it('el listado documenta filtros, cursor y la forma de cada elemento', () => {
    const block = pathBlock('/api/v1/transactions')
    for (const param of ['direction', 'kind', 'status', 'limit', 'cursor']) {
      expect(block, param).toContain(param)
    }
    expect(block).not.toContain('walletAddress')
    for (const field of ['nextCursor', 'counterparty', 'merchantId', 'receiveAmount']) {
      expect(doc, field).toContain(field)
    }
  })

  it('documenta PAYMENT_NOT_FOUND y VALIDATION_ERROR para las consultas', () => {
    expect(doc).toContain('PAYMENT_NOT_FOUND')
    expect(doc).toContain('VALIDATION_ERROR')
  })
})
