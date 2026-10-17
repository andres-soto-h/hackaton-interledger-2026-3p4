import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/shared/errors/app-error.js'
import { exchangeRate } from '../../src/shared/money/money.js'
import type { Amount } from '../../src/shared/money/types.js'
import type { Payment } from '../../src/modules/payments/payment.types.js'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import {
  buildPaymentsContext,
  FAKE_FEE,
  type PaymentsContext
} from '../helpers/payments-context.js'
import { START } from '../helpers/auth-context.js'
import { TEST_API_KEY } from '../helpers/app.js'

const usd = (value: string): Amount => ({ value, assetCode: 'USD' })
const ALICE_BOB = 'https://ilp.interledger-test.dev/bob'

interface QuoteBody {
  paymentId: string
  status: string
  confirmBy: string
  quote: {
    debitAmount: Amount
    receiveAmount: Amount
    exchangeRate: string
    fee: Amount & { percentage: string }
    totalDebit: Amount
  }
  allowance: { dailyLimit: Amount; availableAfter: Amount }
}
interface OptionsBody {
  challengeId: string
  options: {
    challenge: string
    allowCredentials: { id: string }[]
    userVerification: string
  }
}
interface ConfirmBody {
  paymentId: string
  status: string
}

let ctx: PaymentsContext

beforeEach(() => {
  ctx = buildPaymentsContext()
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const post = (path: string, token: string | undefined) => {
  const req = request(ctx.app).post(path)
  return token === undefined ? req : req.set(bearer(token))
}
const quote = (token: string | undefined, body: unknown, key?: string) => {
  const req = post('/api/v1/payments', token)
  return (key === undefined ? req : req.set('idempotency-key', key)).send(body as object)
}
const options = (token: string | undefined, id: string) =>
  post(`/api/v1/payments/${id}/confirm/options`, token)
const confirm = (token: string | undefined, id: string, body: unknown, key?: string) => {
  const req = post(`/api/v1/payments/${id}/confirm`, token)
  return (key === undefined ? req : req.set('idempotency-key', key)).send(body as object)
}
const cancel = (token: string | undefined, id: string) =>
  post(`/api/v1/payments/${id}/cancel`, token)

const p2p = (value = '25.00', extra: Record<string, unknown> = {}) => ({
  type: 'p2p',
  receiverWalletAddress: ALICE_BOB,
  amount: usd(value),
  description: 'Almuerzo',
  ...extra
})

/** Quotes and returns the pieces needed to confirm. */
const quoted = async (
  seeded: { token: string; credentialId: string },
  body: unknown = p2p()
) => {
  const res = await quote(seeded.token, body)
  expect(res.status).toBe(201)
  return bodyOf<QuoteBody>(res)
}
const confirmable = async (
  seeded: { token: string; credentialId: string },
  body: unknown = p2p()
) => {
  const q = await quoted(seeded, body)
  const opts = bodyOf<OptionsBody>(await options(seeded.token, q.paymentId))
  return {
    q,
    challengeId: opts.challengeId,
    credential: { id: seeded.credentialId },
    pay: (key?: string) =>
      confirm(
        seeded.token,
        q.paymentId,
        { challengeId: opts.challengeId, credential: { id: seeded.credentialId } },
        key
      )
  }
}
const stored = async (id: string): Promise<Payment> => {
  const payment = await ctx.payments.getPayment(id)
  if (payment === null) throw new Error(`payment ${id} not stored`)
  return payment
}
const spent = async (userId: string): Promise<string> =>
  (await ctx.walletLinks.getAllowance(userId)).spent.value

// Casos 1, 2, 4
describe('POST /api/v1/payments · cotizar', () => {
  it('caso 1: P2P a una wallet → 201 con quote, comisión, total y disponible; AWAITING_CONFIRMATION', async () => {
    const seeded = await ctx.seedLinkedUser()
    const res = await quote(seeded.token, p2p())

    expect(res.status).toBe(201)
    const body = bodyOf<QuoteBody>(res)
    expect(body.paymentId).toMatch(/^pay_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(body.status).toBe('AWAITING_CONFIRMATION')
    expect(body.confirmBy).toBe(new Date(START + 5 * 60_000).toISOString())
    expect(body.quote).toEqual({
      debitAmount: usd('25.00'),
      receiveAmount: usd('25.00'),
      exchangeRate: exchangeRate(usd('25.00'), usd('25.00')),
      fee: { ...usd(FAKE_FEE), percentage: '1.5' },
      totalDebit: usd('25.38')
    })
    expect(body.allowance).toEqual({
      dailyLimit: usd('200.00'),
      availableAfter: usd('174.62')
    })

    const payment = await stored(body.paymentId)
    expect(payment).toMatchObject({
      userId: seeded.user.id,
      walletLinkId: seeded.linkId,
      type: 'p2p',
      status: 'AWAITING_CONFIRMATION',
      senderWalletAddress: seeded.user.walletAddress,
      receiverWalletAddress: ALICE_BOB,
      totalDebit: usd('25.38'),
      fee: usd(FAKE_FEE),
      feePercentage: '1.5',
      description: 'Almuerzo'
    })
    expect(payment.expiresAt).toBe(Math.floor((START + 5 * 60_000) / 1000))
    expect(await spent(seeded.user.id)).toBe('0.00') // cotizar no reserva
  })

  it('caso 2: con incomingPaymentUrl no crea otro incoming payment', async () => {
    const seeded = await ctx.seedLinkedUser()
    const shop = await ctx.gateway.getWalletAddress(
      'https://ilp.interledger-test.dev/shop'
    )
    const incoming = await ctx.gateway.createIncomingPayment({
      wallet: shop,
      amount: usd('10.00'),
      expiresAt: new Date(START + 3_600_000)
    })
    const create = vi.spyOn(ctx.gateway, 'createIncomingPayment')

    const res = await quote(seeded.token, {
      type: 'p2m',
      incomingPaymentUrl: incoming.id
    })

    expect(res.status).toBe(201)
    expect(create).not.toHaveBeenCalled()
    const body = bodyOf<QuoteBody>(res)
    expect(body.quote.debitAmount).toEqual(usd('10.00'))
    expect((await stored(body.paymentId)).incomingPaymentUrl).toBe(incoming.id)
  })

  it('caso 4: emisor USD y receptor MXN → ambos montos y exchangeRate', async () => {
    const seeded = await ctx.seedLinkedUser()
    // The fake gateway refuses cross-currency quotes, so the conversion is simulated.
    vi.spyOn(ctx.gateway, 'createQuote').mockImplementationOnce((input) =>
      Promise.resolve({
        id: `${input.sender.resourceServer}/quotes/q-cross-currency`,
        walletAddress: input.sender.id,
        receiver: input.receiver,
        debitAmount: usd('25.07'),
        receiveAmount: { value: '430.00', assetCode: 'MXN' },
        expiresAt: new Date(ctx.clock.value + 5 * 60_000)
      })
    )

    const res = await quote(seeded.token, {
      type: 'p2p',
      receiverWalletAddress: 'https://ilp.interledger-test.dev/pesos',
      amount: { value: '430.00', assetCode: 'MXN' }
    })

    expect(res.status).toBe(201)
    const body = bodyOf<QuoteBody>(res)
    expect(body.quote.debitAmount).toEqual(usd('25.07'))
    expect(body.quote.receiveAmount).toEqual({ value: '430.00', assetCode: 'MXN' })
    expect(body.quote.exchangeRate).toBe(
      exchangeRate(usd('25.07'), { value: '430.00', assetCode: 'MXN' })
    )
    expect(body.quote.totalDebit).toEqual(usd('25.45'))
  })

  it('es idempotente con Idempotency-Key: un solo pago y un solo quote', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createQuote = vi.spyOn(ctx.gateway, 'createQuote')
    const first = await quote(seeded.token, p2p(), 'quote-key-0001')
    const second = await quote(seeded.token, p2p(), 'quote-key-0001')

    expect(second.status).toBe(201)
    expect(bodyOf<QuoteBody>(second).paymentId).toBe(bodyOf<QuoteBody>(first).paymentId)
    expect(createQuote).toHaveBeenCalledTimes(1)
  })
})

// Caso 3
describe('POST /api/v1/payments · incoming payment no pagable', () => {
  const makeIncoming = async (amount?: Amount) => {
    const shop = await ctx.gateway.getWalletAddress(
      'https://ilp.interledger-test.dev/shop'
    )
    return ctx.gateway.createIncomingPayment({
      wallet: shop,
      ...(amount === undefined ? {} : { amount }),
      expiresAt: new Date(START + 3_600_000)
    })
  }

  it.each([
    ['completado', { completed: true }],
    ['vencido', { expiresAt: new Date(START - 1000) }]
  ])('%s → 422 INCOMING_PAYMENT_NOT_PAYABLE', async (_name, change) => {
    const seeded = await ctx.seedLinkedUser()
    const incoming = await makeIncoming(usd('10.00'))
    vi.spyOn(ctx.gateway, 'getIncomingPayment').mockResolvedValueOnce({
      ...incoming,
      ...change
    })

    const res = await quote(seeded.token, {
      type: 'p2m',
      incomingPaymentUrl: incoming.id
    })

    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('INCOMING_PAYMENT_NOT_PAYABLE')
  })

  it('sin monto y sin amount en el body → 422 INCOMING_PAYMENT_NOT_PAYABLE', async () => {
    const seeded = await ctx.seedLinkedUser()
    const incoming = await makeIncoming()
    const res = await quote(seeded.token, {
      type: 'p2m',
      incomingPaymentUrl: incoming.id
    })
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('INCOMING_PAYMENT_NOT_PAYABLE')
  })

  it('sin monto pero con amount en el body → 201', async () => {
    const seeded = await ctx.seedLinkedUser()
    const incoming = await makeIncoming()
    const res = await quote(seeded.token, {
      type: 'p2m',
      incomingPaymentUrl: incoming.id,
      amount: usd('12.00')
    })
    expect(res.status).toBe(201)
    expect(bodyOf<QuoteBody>(res).quote.debitAmount).toEqual(usd('12.00'))
  })

  it('una URL de otro host no permitido → 422 WALLET_NOT_ALLOWED (anti-SSRF)', async () => {
    const seeded = await ctx.seedLinkedUser()
    const res = await quote(seeded.token, {
      type: 'p2m',
      incomingPaymentUrl: 'https://evil.example/incoming-payments/x'
    })
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('WALLET_NOT_ALLOWED')
  })
})

// Casos 5 y 6
describe('POST /api/v1/payments · sesión y emisor', () => {
  it('caso 5: sin sesión → 401; solo con API key → 401', async () => {
    const none = await quote(undefined, p2p())
    expect(none.status).toBe(401)
    expect(errorOf(none).code).toBe('SESSION_INVALID')

    const apiKey = await request(ctx.app)
      .post('/api/v1/payments')
      .set('x-api-key', TEST_API_KEY)
      .send(p2p())
    expect(apiKey.status).toBe(401)
    expect(errorOf(apiKey).code).toBe('SESSION_INVALID')
  })

  it('caso 5: sin vinculación ACTIVE → 403 WALLET_NOT_LINKED', async () => {
    const seeded = await ctx.seedUser()
    const res = await quote(seeded.token, p2p())
    expect(res.status).toBe(403)
    expect(errorOf(res).code).toBe('WALLET_NOT_LINKED')
  })

  it('caso 6: senderWalletAddress en el body → 400 VALIDATION_ERROR', async () => {
    const seeded = await ctx.seedLinkedUser()
    const res = await quote(
      seeded.token,
      p2p('25.00', { senderWalletAddress: 'https://ilp.interledger-test.dev/bob' })
    )
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  it('el emisor es siempre la wallet vinculada de la sesión', async () => {
    const bob = await ctx.seedLinkedUser('bob')
    const body = await quoted(bob, {
      type: 'p2p',
      receiverWalletAddress: 'https://ilp.interledger-test.dev/shop',
      amount: usd('5.00')
    })
    expect((await stored(body.paymentId)).senderWalletAddress).toBe(
      bob.user.walletAddress
    )
  })
})

// Caso 7
describe('POST /api/v1/payments · quote y límites', () => {
  it('el quote falla → 422 QUOTE_FAILED y no se guarda nada', async () => {
    const seeded = await ctx.seedLinkedUser()
    ctx.gateway.failNext('createQuote', new AppError(422, 'QUOTE_FAILED', 'quote failed'))

    const res = await quote(seeded.token, p2p())

    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('QUOTE_FAILED')
    const list = await ctx.payments.listByWallet({
      walletAddress: seeded.user.walletAddress,
      direction: 'all',
      kind: 'payment',
      limit: 10
    })
    expect(list.items).toHaveLength(0)
  })

  it('debitAmount sobre MAX_PAYMENT_AMOUNTS → 422 AMOUNT_EXCEEDS_LIMIT y no se guarda nada', async () => {
    ctx = buildPaymentsContext({ settings: { maxPaymentAmounts: { USD: '50' } } })
    const seeded = await ctx.seedLinkedUser()

    const res = await quote(seeded.token, p2p('60.00'))

    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('AMOUNT_EXCEEDS_LIMIT')
    const list = await ctx.payments.listByWallet({
      walletAddress: seeded.user.walletAddress,
      direction: 'all',
      kind: 'payment',
      limit: 10
    })
    expect(list.items).toHaveLength(0)
  })
})

// Caso 8
describe('monto diario', () => {
  it('al cotizar: total sobre el disponible → 422 DAILY_LIMIT_EXCEEDED sin reserva', async () => {
    const seeded = await ctx.seedLinkedUser()
    const res = await quote(seeded.token, p2p('199.80')) // total 200.18 > 200.00
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('DAILY_LIMIT_EXCEEDED')
    expect(await spent(seeded.user.id)).toBe('0.00')
  })

  it('al confirmar: el segundo pago ya no cabe → 422, vuelve a AWAITING_CONFIRMATION y no mueve dinero', async () => {
    const seeded = await ctx.seedLinkedUser()
    const first = await confirmable(seeded, p2p('120.00')) // total 120.38
    const second = await confirmable(seeded, p2p('100.00')) // total 100.38

    expect((await first.pay()).status).toBe(202)
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const res = await second.pay()

    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('DAILY_LIMIT_EXCEEDED')
    expect(createOutgoing).not.toHaveBeenCalled()
    expect((await stored(second.q.paymentId)).status).toBe('AWAITING_CONFIRMATION')
    expect(await spent(seeded.user.id)).toBe('120.38')
  })
})

// Casos 9, 17, 18, 19
describe('confirmación con passkey', () => {
  it('caso 19: las opciones traen allowCredentials del usuario, userVerification required y un desafío ligado al pago', async () => {
    const seeded = await ctx.seedLinkedUser()
    const q = await quoted(seeded)

    const res = await options(seeded.token, q.paymentId)

    expect(res.status).toBe(200)
    const body = bodyOf<OptionsBody>(res)
    expect(body.challengeId).toMatch(/^chl_/)
    expect(body.options.allowCredentials.map((c) => c.id)).toEqual([seeded.credentialId])
    expect(body.options.userVerification).toBe('required')
  })

  it('caso 9: confirmar válido → 202 PROCESSING, reserva del total y outgoing payment con quoteId y token', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const c = await confirmable(seeded)

    const res = await c.pay()

    expect(res.status).toBe(202)
    expect(res.headers['retry-after']).toBe('2')
    expect(bodyOf<ConfirmBody>(res)).toEqual({
      paymentId: c.q.paymentId,
      status: 'PROCESSING'
    })
    expect(createOutgoing).toHaveBeenCalledTimes(1)
    const payment = await stored(c.q.paymentId)
    expect(createOutgoing).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: payment.quote.id })
    )
    const call = createOutgoing.mock.calls[0]?.[0]
    expect(typeof call?.accessToken).toBe('string')
    expect(payment).toMatchObject({
      status: 'PROCESSING',
      reservedAmount: usd('25.38')
    })
    expect(payment.outgoingPaymentUrl).toMatch(/\/outgoing-payments\//)
    expect(payment.expiresAt).toBeUndefined()
    expect(await spent(seeded.user.id)).toBe('25.38')
  })

  it('cobra la comisión sin afectar al pago principal si falla', async () => {
    const seeded = await ctx.seedLinkedUser()
    vi.mocked(ctx.feeCollector.collect).mockRejectedValueOnce(new Error('fee failed'))
    const c = await confirmable(seeded)

    const res = await c.pay()

    expect(res.status).toBe(202)
    expect(ctx.feeCollector.collect).toHaveBeenCalledTimes(1)
    expect((await stored(c.q.paymentId)).status).toBe('PROCESSING')
  })

  it('caso 17: sin credential → 400 VALIDATION_ERROR', async () => {
    const seeded = await ctx.seedLinkedUser()
    const c = await confirmable(seeded)
    const res = await confirm(seeded.token, c.q.paymentId, { challengeId: c.challengeId })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  it('caso 17: firma inválida → 400 PASSKEY_VERIFICATION_FAILED; el pago no cambia y no hay reserva', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const c = await confirmable(seeded)

    const res = await confirm(seeded.token, c.q.paymentId, {
      challengeId: c.challengeId,
      credential: { id: seeded.credentialId, ok: false }
    })

    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('PASSKEY_VERIFICATION_FAILED')
    expect((await stored(c.q.paymentId)).status).toBe('AWAITING_CONFIRMATION')
    expect(await spent(seeded.user.id)).toBe('0.00')
    expect(createOutgoing).not.toHaveBeenCalled()
  })

  it('caso 17: passkey de otro usuario → 400 PASSKEY_VERIFICATION_FAILED', async () => {
    const seeded = await ctx.seedLinkedUser()
    const bob = await ctx.seedUser('bob')
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const c = await confirmable(seeded)

    const res = await confirm(seeded.token, c.q.paymentId, {
      challengeId: c.challengeId,
      credential: { id: bob.credentialId }
    })

    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('PASSKEY_VERIFICATION_FAILED')
    expect((await stored(c.q.paymentId)).status).toBe('AWAITING_CONFIRMATION')
    expect(createOutgoing).not.toHaveBeenCalled()
  })

  it('caso 18: el desafío de otro pago → 400 CHALLENGE_EXPIRED sin mover dinero', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const a = await confirmable(seeded)
    const b = await quoted(seeded, p2p('10.00'))

    const res = await confirm(seeded.token, b.paymentId, {
      challengeId: a.challengeId,
      credential: a.credential
    })

    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
    expect(createOutgoing).not.toHaveBeenCalled()
    expect(await spent(seeded.user.id)).toBe('0.00')
  })

  it('caso 18: un desafío ya usado → 400 CHALLENGE_EXPIRED y un solo outgoing payment', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const c = await confirmable(seeded)

    expect((await c.pay()).status).toBe(202)
    const again = await c.pay()

    expect(again.status).toBe(400)
    expect(errorOf(again).code).toBe('CHALLENGE_EXPIRED')
    expect(createOutgoing).toHaveBeenCalledTimes(1)
  })

  it('caso 18: un desafío vencido (más de 2 minutos) → 400 CHALLENGE_EXPIRED', async () => {
    const seeded = await ctx.seedLinkedUser()
    const c = await confirmable(seeded)
    ctx.advanceSeconds(121)
    const res = await c.pay()
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
    expect((await stored(c.q.paymentId)).status).toBe('AWAITING_CONFIRMATION')
  })

  it('caso 18: un desafío de tipo login → 400 CHALLENGE_EXPIRED', async () => {
    const seeded = await ctx.seedLinkedUser()
    const q = await quoted(seeded)
    await ctx.users.createChallenge({
      id: 'chl_01JLOGINLOGINLOGINLOGINLOG',
      challenge: 'login-challenge',
      type: 'login',
      expiresAt: Math.floor(START / 1000) + 300
    })
    const res = await confirm(seeded.token, q.paymentId, {
      challengeId: 'chl_01JLOGINLOGINLOGINLOGINLOG',
      credential: { id: seeded.credentialId }
    })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
  })

  it('el desafío de pago nunca vive más que el quote', async () => {
    const seeded = await ctx.seedLinkedUser()
    const q = await quoted(seeded)
    ctx.advanceSeconds(250) // quedan 50 s de quote
    const opts = bodyOf<OptionsBody>(await options(seeded.token, q.paymentId))
    ctx.advanceSeconds(60) // el quote venció; el desafío (<=50 s) también
    const res = await confirm(seeded.token, q.paymentId, {
      challengeId: opts.challengeId,
      credential: { id: seeded.credentialId }
    })
    expect([400, 410]).toContain(res.status)
  })

  it('caso 19: opciones de un pago ajeno → 404; de un pago no confirmable → 409', async () => {
    const seeded = await ctx.seedLinkedUser()
    const bob = await ctx.seedLinkedUser('bob')
    const q = await quoted(seeded)

    const foreign = await options(bob.token, q.paymentId)
    expect(foreign.status).toBe(404)
    expect(errorOf(foreign).code).toBe('PAYMENT_NOT_FOUND')

    expect((await cancel(seeded.token, q.paymentId)).status).toBe(204)
    const notConfirmable = await options(seeded.token, q.paymentId)
    expect(notConfirmable.status).toBe(409)
    expect(errorOf(notConfirmable).code).toBe('PAYMENT_NOT_CONFIRMABLE')
  })
})

// Casos 10 a 13
describe('confirmación · errores y concurrencia', () => {
  it('caso 10: confirmar un pago de otro usuario → 404 PAYMENT_NOT_FOUND', async () => {
    const seeded = await ctx.seedLinkedUser()
    const bob = await ctx.seedLinkedUser('bob')
    const c = await confirmable(seeded)

    const res = await confirm(bob.token, c.q.paymentId, {
      challengeId: c.challengeId,
      credential: { id: bob.credentialId }
    })

    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('PAYMENT_NOT_FOUND')
    expect((await stored(c.q.paymentId)).status).toBe('AWAITING_CONFIRMATION')
  })

  it('un pago inexistente → 404 PAYMENT_NOT_FOUND', async () => {
    const seeded = await ctx.seedLinkedUser()
    const res = await confirm(seeded.token, 'pay_01JNOTEXISTSNOTEXISTSNOTEX', {
      challengeId: 'chl_x',
      credential: { id: seeded.credentialId }
    })
    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('PAYMENT_NOT_FOUND')
  })

  it('caso 11: dos confirmaciones en paralelo → un solo outgoing payment; la otra 409 PAYMENT_NOT_CONFIRMABLE', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const q = await quoted(seeded)
    const first = bodyOf<OptionsBody>(await options(seeded.token, q.paymentId))
    const second = bodyOf<OptionsBody>(await options(seeded.token, q.paymentId))

    const results = await Promise.all(
      [first, second].map((o) =>
        confirm(seeded.token, q.paymentId, {
          challengeId: o.challengeId,
          credential: { id: seeded.credentialId }
        })
      )
    )

    expect(results.map((r) => r.status).sort()).toEqual([202, 409])
    const loser = results.find((r) => r.status === 409)
    expect(loser && errorOf(loser).code).toBe('PAYMENT_NOT_CONFIRMABLE')
    expect(createOutgoing).toHaveBeenCalledTimes(1)
    expect(await spent(seeded.user.id)).toBe('25.38')
  })

  it('con la misma Idempotency-Key repite la respuesta y crea un solo outgoing payment', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const c = await confirmable(seeded)
    const first = await c.pay('confirm-key-0001')
    const second = await c.pay('confirm-key-0001')
    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(second.body).toEqual(first.body)
    expect(createOutgoing).toHaveBeenCalledTimes(1)
  })

  it('caso 12: el quote venció → el pago pasa a EXPIRED y responde 410 QUOTE_EXPIRED', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const c = await confirmable(seeded)
    ctx.advanceSeconds(301)

    const res = await c.pay()

    expect(res.status).toBe(410)
    expect(errorOf(res).code).toBe('QUOTE_EXPIRED')
    expect((await stored(c.q.paymentId)).status).toBe('EXPIRED')
    expect(createOutgoing).not.toHaveBeenCalled()
    expect(await spent(seeded.user.id)).toBe('0.00')
  })

  it('caso 12: pedir opciones con el quote vencido → EXPIRED y 410', async () => {
    const seeded = await ctx.seedLinkedUser()
    const q = await quoted(seeded)
    ctx.advanceSeconds(301)
    const res = await options(seeded.token, q.paymentId)
    expect(res.status).toBe(410)
    expect(errorOf(res).code).toBe('QUOTE_EXPIRED')
    expect((await stored(q.paymentId)).status).toBe('EXPIRED')
  })

  it('caso 13: falla el outgoing payment → FAILED y la reserva se libera', async () => {
    const seeded = await ctx.seedLinkedUser()
    ctx.gateway.failNext('createOutgoingPayment', new Error('boom'))
    const c = await confirmable(seeded)

    const res = await c.pay()

    expect(res.status).toBeGreaterThanOrEqual(500)
    const payment = await stored(c.q.paymentId)
    expect(payment.status).toBe('FAILED')
    expect(payment.error?.code).toBeTypeOf('string')
    expect(await spent(seeded.user.id)).toBe('0.00')
    expect(ctx.feeCollector.collect).not.toHaveBeenCalled()
  })

  it('caso 13: vinculación revocada al rotar el token → 409 WALLET_LINK_REVOKED, FAILED y reserva liberada', async () => {
    ctx = buildPaymentsContext({ tokenTtlSeconds: 30 }) // el token siempre está por vencer
    const seeded = await ctx.seedLinkedUser()
    const c = await confirmable(seeded)
    ctx.gateway.revokeGrants()

    const res = await c.pay()

    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('WALLET_LINK_REVOKED')
    expect((await stored(c.q.paymentId)).status).toBe('FAILED')
    const allowance = await ctx.links.findActiveByUser(seeded.user.id)
    expect(allowance).toBeNull() // la vinculación quedó REVOKED
  })
})

// Caso 14
describe('POST /api/v1/payments/{id}/cancel', () => {
  it('en AWAITING_CONFIRMATION → 204 y CANCELLED', async () => {
    const seeded = await ctx.seedLinkedUser()
    const q = await quoted(seeded)
    const res = await cancel(seeded.token, q.paymentId)
    expect(res.status).toBe(204)
    expect((await stored(q.paymentId)).status).toBe('CANCELLED')
  })

  it('en otro estado → 409 PAYMENT_NOT_CANCELLABLE', async () => {
    const seeded = await ctx.seedLinkedUser()
    const c = await confirmable(seeded)
    expect((await c.pay()).status).toBe(202)
    const res = await cancel(seeded.token, c.q.paymentId)
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('PAYMENT_NOT_CANCELLABLE')
    expect((await stored(c.q.paymentId)).status).toBe('PROCESSING')
  })

  it('un pago ajeno → 404 PAYMENT_NOT_FOUND', async () => {
    const seeded = await ctx.seedLinkedUser()
    const bob = await ctx.seedLinkedUser('bob')
    const q = await quoted(seeded)
    const res = await cancel(bob.token, q.paymentId)
    expect(res.status).toBe(404)
    expect((await stored(q.paymentId)).status).toBe('AWAITING_CONFIRMATION')
  })
})

// Caso 15
describe('paymentsEnabled = false', () => {
  it('cotizar, pedir opciones y confirmar → 503 PAYMENTS_DISABLED; cancelar sigue permitido', async () => {
    const seeded = await ctx.seedLinkedUser()
    const c = await confirmable(seeded)
    ctx.editable.paymentsEnabled = false

    const quoteRes = await quote(seeded.token, p2p())
    const optionsRes = await options(seeded.token, c.q.paymentId)
    const confirmRes = await c.pay()
    for (const res of [quoteRes, optionsRes, confirmRes]) {
      expect(res.status).toBe(503)
      expect(errorOf(res).code).toBe('PAYMENTS_DISABLED')
    }
    expect((await stored(c.q.paymentId)).status).toBe('AWAITING_CONFIRMATION')

    expect((await cancel(seeded.token, c.q.paymentId)).status).toBe(204)
  })
})

// Caso 16
describe('rutas protegidas por sesión', () => {
  it.each([
    '/api/v1/payments',
    '/api/v1/payments/pay_01JSESSIONSESSIONSESSIONSE/confirm/options',
    '/api/v1/payments/pay_01JSESSIONSESSIONSESSIONSE/confirm',
    '/api/v1/payments/pay_01JSESSIONSESSIONSESSIONSE/cancel'
  ])(
    'POST %s sin sesión → 401 SESSION_INVALID (aunque lleve la API key)',
    async (path) => {
      for (const withKey of [false, true]) {
        const req = request(ctx.app).post(path)
        const res = await (withKey ? req.set('x-api-key', TEST_API_KEY) : req).send({})
        expect(res.status).toBe(401)
        expect(errorOf(res).code).toBe('SESSION_INVALID')
      }
    }
  )
})
