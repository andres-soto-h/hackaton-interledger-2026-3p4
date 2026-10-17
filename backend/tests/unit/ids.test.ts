import { describe, expect, it } from 'vitest'
import { newId, newPaymentId, newPaymentRequestId } from '../../src/shared/ids/ids.js'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Decodes the 48-bit timestamp stored in the first 10 characters of a ULID. */
const ulidTime = (ulid: string): number =>
  [...ulid.slice(0, 10)].reduce((acc, char) => acc * 32 + CROCKFORD.indexOf(char), 0)

describe('ids', () => {
  // Caso 9
  it('genera IDs de pago y de solicitud con su prefijo y un ULID', () => {
    expect(newPaymentId()).toMatch(/^pay_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(newPaymentRequestId()).toMatch(/^pr_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(newId('idem')).toMatch(/^idem_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('genera IDs únicos', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newPaymentId()))
    expect(ids.size).toBe(2000)
  })

  it('codifica el instante de creación en el ULID', () => {
    const now = Date.UTC(2026, 9, 16, 10, 0, 0)
    expect(ulidTime(newPaymentId(now).slice('pay_'.length))).toBe(now)
  })

  it('ordena los IDs por fecha de creación', () => {
    const base = Date.UTC(2026, 9, 16, 10, 0, 0)
    const ids = [3, 1, 2, 0].map((offset) => newPaymentId(base + offset * 1000))
    const sorted = [...ids].sort()
    expect(sorted).toEqual([ids[3], ids[1], ids[2], ids[0]])
  })
})
