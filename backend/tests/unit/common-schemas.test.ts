import { describe, expect, it } from 'vitest'
import {
  amountSchema,
  descriptionSchema,
  paginationQuerySchema,
  walletAddressSchema
} from '../../src/shared/validation/schemas.js'

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success

// Caso 10
describe('amountSchema', () => {
  it.each(['0.01', '10', '10.50', '1000000.123456789'])('acepta %s', (value) => {
    expect(ok(amountSchema, { value, assetCode: 'USD' })).toBe(true)
  })

  it.each(['0', '0.00', '-1', '1e3', 'abc', '', '1.', '.5', ' 1', '1,5'])(
    'rechaza el valor %j',
    (value) => {
      expect(ok(amountSchema, { value, assetCode: 'USD' })).toBe(false)
    }
  )

  it.each(['usd', 'US', 'USDX', '', 'U$D'])('rechaza el código %j', (assetCode) => {
    expect(ok(amountSchema, { value: '1', assetCode })).toBe(false)
  })

  it('es estricto: rechaza campos extra y un valor numérico', () => {
    expect(ok(amountSchema, { value: '1', assetCode: 'USD', extra: 1 })).toBe(false)
    expect(ok(amountSchema, { value: 1, assetCode: 'USD' })).toBe(false)
  })
})

describe('walletAddressSchema', () => {
  it.each(['https://ilp.interledger-test.dev/alice', '$ilp.interledger-test.dev/alice'])(
    'acepta %s',
    (v) => expect(ok(walletAddressSchema, v)).toBe(true)
  )

  it.each(['http://x.test/a', 'alice', '', 'ftp://x.test/a', 12])('rechaza %j', (v) =>
    expect(ok(walletAddressSchema, v)).toBe(false)
  )

  it('límite de 2048 caracteres', () => {
    const base = 'https://a.test/'
    expect(ok(walletAddressSchema, base + 'a'.repeat(2048 - base.length))).toBe(true)
    expect(ok(walletAddressSchema, base + 'a'.repeat(2049 - base.length))).toBe(false)
  })
})

describe('descriptionSchema', () => {
  it('es opcional', () => expect(ok(descriptionSchema, undefined)).toBe(true))
  it('acepta 140 caracteres y rechaza 141', () => {
    expect(ok(descriptionSchema, 'a'.repeat(140))).toBe(true)
    expect(ok(descriptionSchema, 'a'.repeat(141))).toBe(false)
  })
  it.each(['a\nb', 'a\u0000b', 'a\tb', 'a\u007fb'])(
    'rechaza caracteres de control %j',
    (v) => expect(ok(descriptionSchema, v)).toBe(false)
  )
})

describe('paginationQuerySchema', () => {
  it('limit por defecto 20', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 })
  })
  it('convierte limit de texto a número y conserva el cursor', () => {
    expect(paginationQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc'
    })
  })
  it.each(['0', '101', '-1', '1.5', 'abc'])('rechaza limit %j', (limit) => {
    expect(ok(paginationQuerySchema, { limit })).toBe(false)
  })
  it('acepta los extremos 1 y 100', () => {
    expect(ok(paginationQuerySchema, { limit: '1' })).toBe(true)
    expect(ok(paginationQuerySchema, { limit: '100' })).toBe(true)
  })
})
