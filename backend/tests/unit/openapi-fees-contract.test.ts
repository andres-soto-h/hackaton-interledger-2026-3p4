import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tarea 6 del spec 024: el contrato describe la comisión en cotizaciones y en el estado del pago (comprobación ligera, sin parser YAML).
describe('openapi.yaml · comisión', () => {
  const doc = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')

  const schemaBlock = (name: string): string => {
    const match = new RegExp(`^    ${name}:\\s*\\n((?:      .*\\n|\\n)+)`, 'm').exec(doc)
    expect(match, `schema ${name}`).not.toBeNull()
    return match?.[1] ?? ''
  }

  it('la cotización incluye comisión con porcentaje y total a debitar', () => {
    const block = schemaBlock('PaymentQuote')
    expect(block).toMatch(/required: \[[^\]]*\bfee\b[^\]]*\btotalDebit\b/)
    expect(block).toContain('percentage')
  })

  it('el estado del pago incluye fee, feeStatus y totalDebit', () => {
    const block = schemaBlock('PaymentStatus')
    for (const field of ['fee', 'feeStatus', 'totalDebit']) {
      expect(block).toContain(`- ${field}`)
    }
  })

  it('feeStatus enumera los cinco estados y explica el cobro en dos pasos', () => {
    const block = schemaBlock('PaymentStatus')
    expect(block).toContain('enum: [NONE, PENDING, PROCESSING, COLLECTED, FAILED]')
    const feeStatus = /feeStatus:\n((?: {10}.*\n)+)/.exec(block)?.[1] ?? ''
    expect(feeStatus).toMatch(/description:/)
    expect(feeStatus).toContain('segundo outgoing payment')
  })
})
