import { describe, expect, it } from 'vitest'
import {
  confirmPaymentBodySchema,
  createPaymentBodySchema
} from '../../src/modules/payments/payments.schema.js'

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success
const amount = { value: '25.00', assetCode: 'USD' }
const wallet = 'https://ilp.interledger-test.dev/bob'
const incoming = 'https://ilp.interledger-test.dev/incoming-payments/abc'

describe('createPaymentBodySchema', () => {
  it('acepta P2P con wallet y monto', () => {
    expect(
      ok(createPaymentBodySchema, {
        type: 'p2p',
        receiverWalletAddress: wallet,
        amount,
        description: 'Almuerzo'
      })
    ).toBe(true)
  })

  it('acepta P2M con incomingPaymentUrl, con y sin monto', () => {
    expect(
      ok(createPaymentBodySchema, { type: 'p2m', incomingPaymentUrl: incoming })
    ).toBe(true)
    expect(
      ok(createPaymentBodySchema, { type: 'p2m', incomingPaymentUrl: incoming, amount })
    ).toBe(true)
  })

  it.each([
    [
      'las dos variantes a la vez',
      { type: 'p2p', receiverWalletAddress: wallet, incomingPaymentUrl: incoming, amount }
    ],
    ['P2P sin monto', { type: 'p2p', receiverWalletAddress: wallet }],
    ['sin ninguna variante', { type: 'p2p', amount }],
    [
      'senderWalletAddress',
      { type: 'p2p', receiverWalletAddress: wallet, amount, senderWalletAddress: wallet }
    ],
    ['tipo desconocido', { type: 'p2x', receiverWalletAddress: wallet, amount }],
    [
      'monto inválido',
      {
        type: 'p2p',
        receiverWalletAddress: wallet,
        amount: { value: '0', assetCode: 'USD' }
      }
    ],
    [
      'descripción de 141 caracteres',
      { type: 'p2p', receiverWalletAddress: wallet, amount, description: 'a'.repeat(141) }
    ],
    ['campo extra', { type: 'p2p', receiverWalletAddress: wallet, amount, extra: 1 }]
  ])('rechaza %s', (_name, body) => {
    expect(ok(createPaymentBodySchema, body)).toBe(false)
  })
})

describe('confirmPaymentBodySchema', () => {
  it('exige challengeId y credential', () => {
    expect(
      ok(confirmPaymentBodySchema, { challengeId: 'chl_1', credential: { id: 'x' } })
    ).toBe(true)
    expect(ok(confirmPaymentBodySchema, { challengeId: 'chl_1' })).toBe(false)
    expect(ok(confirmPaymentBodySchema, { credential: { id: 'x' } })).toBe(false)
  })
})
