import { describe, expect, it } from 'vitest'
import { createPaymentRequestBodySchema } from '../../src/modules/payments/payment-requests.schema.js'

const base = {
  type: 'p2m',
  receiverWalletAddress: 'https://ilp.interledger-test.dev/shop'
}

describe('createPaymentRequestBodySchema', () => {
  it('acepta lo mínimo y aplica 900 s por defecto', () => {
    expect(createPaymentRequestBodySchema.parse(base)).toEqual({
      ...base,
      expiresInSeconds: 900
    })
  })

  it('acepta todos los campos', () => {
    const full = {
      ...base,
      amount: { value: '10.50', assetCode: 'USD' },
      description: 'Café',
      expiresInSeconds: 60
    }
    expect(createPaymentRequestBodySchema.parse(full)).toEqual(full)
  })

  it.each([60, 900, 86400])('acepta expiresInSeconds %i', (expiresInSeconds) => {
    expect(
      createPaymentRequestBodySchema.safeParse({ ...base, expiresInSeconds }).success
    ).toBe(true)
  })

  it.each([0, 59, 86401, 1.5, '900', -1])(
    'rechaza expiresInSeconds %j',
    (expiresInSeconds) => {
      expect(
        createPaymentRequestBodySchema.safeParse({ ...base, expiresInSeconds }).success
      ).toBe(false)
    }
  )

  it('rechaza campos desconocidos y type inválido', () => {
    expect(createPaymentRequestBodySchema.safeParse({ ...base, extra: 1 }).success).toBe(
      false
    )
    expect(
      createPaymentRequestBodySchema.safeParse({ ...base, type: 'p2x' }).success
    ).toBe(false)
  })
})
