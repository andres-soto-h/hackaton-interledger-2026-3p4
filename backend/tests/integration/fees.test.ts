import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payment } from '../../src/modules/payments/payment.types.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import type { Amount } from '../../src/shared/money/types.js'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import {
  buildPaymentsContext,
  PLATFORM_WALLET,
  type PaymentsContext
} from '../helpers/payments-context.js'

const usd = (value: string): Amount => ({ value, assetCode: 'USD' })
const BOB = 'https://ilp.interledger-test.dev/bob'

interface QuoteBody {
  paymentId: string
  quote: {
    debitAmount: Amount
    fee: Amount & { percentage: string }
    totalDebit: Amount
  }
}
interface OptionsBody {
  challengeId: string
}

let ctx: PaymentsContext

beforeEach(() => {
  ctx = buildPaymentsContext({ fees: 'real', settings: { feePercentage: '1.5' } })
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const quote = (token: string, amount: string) =>
  request(ctx.app)
    .post('/api/v1/payments')
    .set(bearer(token))
    .send({ type: 'p2p', receiverWalletAddress: BOB, amount: usd(amount) })

/** Quotes, asks for the options and confirms with the fake passkey. */
const pay = async (
  seeded: { token: string; credentialId: string },
  amount = '10.00'
): Promise<{ paymentId: string; quoted: QuoteBody }> => {
  const quoteRes = await quote(seeded.token, amount)
  expect(quoteRes.status).toBe(201)
  const quoted = bodyOf<QuoteBody>(quoteRes)
  const opts = bodyOf<OptionsBody>(
    await request(ctx.app)
      .post(`/api/v1/payments/${quoted.paymentId}/confirm/options`)
      .set(bearer(seeded.token))
  )
  const res = await request(ctx.app)
    .post(`/api/v1/payments/${quoted.paymentId}/confirm`)
    .set(bearer(seeded.token))
    .send({ challengeId: opts.challengeId, credential: { id: seeded.credentialId } })
  expect(res.status).toBeLessThan(300)
  return { paymentId: quoted.paymentId, quoted }
}

const stored = async (id: string): Promise<Payment> => {
  const payment = await ctx.payments.getPayment(id)
  if (payment === null) throw new Error(`payment ${id} not stored`)
  return payment
}
const spent = async (userId: string): Promise<string> =>
  (await ctx.walletLinks.getAllowance(userId)).spent.value

const externalError = () =>
  new AppError(502, 'OPEN_PAYMENTS_ERROR', 'Open Payments error')

// Caso 3
describe('comisión en la cotización', () => {
  it('muestra fee, porcentaje y total a debitar, y guarda feeStatus PENDING', async () => {
    const seeded = await ctx.seedLinkedUser()
    const res = await quote(seeded.token, '10.00')

    expect(res.status).toBe(201)
    const body = bodyOf<QuoteBody>(res)
    expect(body.quote.debitAmount).toEqual(usd('10.00'))
    expect(body.quote.fee).toEqual({ value: '0.15', assetCode: 'USD', percentage: '1.5' })
    expect(body.quote.totalDebit).toEqual(usd('10.15'))

    const payment = await stored(body.paymentId)
    expect(payment).toMatchObject({
      feePercentage: '1.5',
      fee: usd('0.15'),
      totalDebit: usd('10.15'),
      feeStatus: 'PENDING'
    })
  })

  it('con 0 % la comisión es cero y feeStatus es NONE', async () => {
    ctx.editable.feePercentage = '0'
    const seeded = await ctx.seedLinkedUser()
    const body = bodyOf<QuoteBody>(await quote(seeded.token, '10.00'))
    expect(body.quote.fee.value).toBe('0.00')
    expect(body.quote.totalDebit).toEqual(usd('10.00'))
    expect((await stored(body.paymentId)).feeStatus).toBe('NONE')
  })
})

// Caso 4
describe('cobro de la comisión al confirmar', () => {
  it('crea dos outgoing payments, reserva el total y deja feeStatus PROCESSING', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    const createIncoming = vi.spyOn(ctx.gateway, 'createIncomingPayment')
    const createQuote = vi.spyOn(ctx.gateway, 'createQuote')

    const { paymentId } = await pay(seeded)

    const payment = await stored(paymentId)
    expect(payment.status).toBe('PROCESSING')
    expect(payment.feeStatus).toBe('PROCESSING')
    expect(payment.outgoingPaymentUrl).toBeDefined()
    expect(payment.feeOutgoingPaymentUrl).toBeDefined()
    expect(payment.feeIncomingPaymentUrl).toBeDefined()
    expect(payment.feeOutgoingPaymentUrl).not.toBe(payment.outgoingPaymentUrl)
    expect(await spent(seeded.user.id)).toBe('10.15')

    expect(createOutgoing).toHaveBeenCalledTimes(2)
    // El incoming de la comisión se crea en la wallet de la plataforma, sin monto.
    const platformIncoming = createIncoming.mock.calls.at(-1)?.[0]
    expect(platformIncoming?.wallet.id).toBe(PLATFORM_WALLET.id)
    expect(platformIncoming?.amount).toBeUndefined()
    // El quote de la comisión fija el débito: el usuario paga exactamente la comisión.
    const feeQuoteInput = createQuote.mock.calls.at(-1)?.[0]
    expect(feeQuoteInput?.receiver).toBe(payment.feeIncomingPaymentUrl)
    expect(feeQuoteInput?.debitAmount).toEqual(usd('0.15'))
    const feeOutgoingInput = createOutgoing.mock.calls.at(-1)?.[0]
    expect(feeOutgoingInput?.quoteId).not.toBe(payment.quote.id)
  })
})

// Caso 5
describe('comisión que da cero', () => {
  it('crea un solo outgoing payment y feeStatus NONE', async () => {
    ctx.editable.feePercentage = '0'
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')

    const { paymentId } = await pay(seeded)

    expect(createOutgoing).toHaveBeenCalledTimes(1)
    const payment = await stored(paymentId)
    expect(payment.feeStatus).toBe('NONE')
    expect(payment.feeOutgoingPaymentUrl).toBeUndefined()
    expect(await spent(seeded.user.id)).toBe('10.00')
  })
})

// Caso 6
describe('falla el pago principal', () => {
  it('no cobra la comisión y libera la reserva completa', async () => {
    const seeded = await ctx.seedLinkedUser()
    const createOutgoing = vi.spyOn(ctx.gateway, 'createOutgoingPayment')
    ctx.gateway.failNext('createOutgoingPayment', externalError())

    const quoted = bodyOf<QuoteBody>(await quote(seeded.token, '10.00'))
    const opts = bodyOf<OptionsBody>(
      await request(ctx.app)
        .post(`/api/v1/payments/${quoted.paymentId}/confirm/options`)
        .set(bearer(seeded.token))
    )
    const res = await request(ctx.app)
      .post(`/api/v1/payments/${quoted.paymentId}/confirm`)
      .set(bearer(seeded.token))
      .send({ challengeId: opts.challengeId, credential: { id: seeded.credentialId } })

    expect(res.status).toBe(502)
    expect(errorOf(res).code).toBe('OPEN_PAYMENTS_ERROR')
    expect(createOutgoing).toHaveBeenCalledTimes(1)
    const payment = await stored(quoted.paymentId)
    expect(payment.status).toBe('FAILED')
    expect(payment.feeStatus).toBe('NONE')
    expect(payment.feeOutgoingPaymentUrl).toBeUndefined()
    expect(await spent(seeded.user.id)).toBe('0.00')
  })
})

/** The first outgoing payment (main) works; the next one (fee) fails `times` times. */
const failFeeOutgoing = (times: number) => {
  const real = ctx.gateway.createOutgoingPayment.bind(ctx.gateway)
  const spy = vi.spyOn(ctx.gateway, 'createOutgoingPayment').mockImplementationOnce(real)
  for (let i = 0; i < times; i += 1) spy.mockRejectedValueOnce(externalError())
  return spy
}

// Caso 7
describe('falla la comisión', () => {
  it('el pago sigue su curso, la comisión queda FAILED y se libera solo su parte', async () => {
    const seeded = await ctx.seedLinkedUser()
    failFeeOutgoing(1)

    const { paymentId } = await pay(seeded)

    const payment = await stored(paymentId)
    expect(payment.status).toBe('PROCESSING')
    expect(payment.outgoingPaymentUrl).toBeDefined()
    expect(payment.feeStatus).toBe('FAILED')
    expect(await spent(seeded.user.id)).toBe('10.00')
  })

  it('al refrescar reintenta una vez y luego pasa a COLLECTED cuando el pago de la comisión termina', async () => {
    const seeded = await ctx.seedLinkedUser()
    failFeeOutgoing(1)
    const { paymentId } = await pay(seeded)

    const retried = await ctx.feeCollector.refresh(await stored(paymentId))
    expect(retried.feeStatus).toBe('PROCESSING')
    expect(retried.feeOutgoingPaymentUrl).toBeDefined()
    expect(await spent(seeded.user.id)).toBe('10.15') // la comisión se reservó de nuevo

    ctx.gateway.completeOutgoingPayment(retried.feeOutgoingPaymentUrl ?? '')
    const collected = await ctx.feeCollector.refresh(retried)
    expect(collected.feeStatus).toBe('COLLECTED')
    expect((await stored(paymentId)).feeStatus).toBe('COLLECTED')
  })

  it('si el reintento también falla queda FAILED y no se vuelve a intentar', async () => {
    const seeded = await ctx.seedLinkedUser()
    const spy = failFeeOutgoing(2)
    const { paymentId } = await pay(seeded)
    expect(spy).toHaveBeenCalledTimes(2)

    const second = await ctx.feeCollector.refresh(await stored(paymentId))
    expect(second.feeStatus).toBe('FAILED')
    expect(spy).toHaveBeenCalledTimes(3)
    expect(await spent(seeded.user.id)).toBe('10.00')

    const third = await ctx.feeCollector.refresh(second)
    expect(third.feeStatus).toBe('FAILED')
    expect(spy).toHaveBeenCalledTimes(3) // sin tercer intento: queda para el panel
  })

  it('si el outgoing payment de la comisión falla en Open Payments pasa a FAILED y libera su parte', async () => {
    const seeded = await ctx.seedLinkedUser()
    const { paymentId } = await pay(seeded)
    const payment = await stored(paymentId)
    expect(payment.feeStatus).toBe('PROCESSING')

    ctx.gateway.failOutgoingPayment(payment.feeOutgoingPaymentUrl ?? '')
    const refreshed = await ctx.feeCollector.refresh(payment)

    expect(refreshed.feeStatus).toBe('FAILED')
    expect(await spent(seeded.user.id)).toBe('10.00')
  })

  it('un refresco sin cambios (comisión en curso) no hace nada', async () => {
    const seeded = await ctx.seedLinkedUser()
    const { paymentId } = await pay(seeded)
    const payment = await stored(paymentId)

    const refreshed = await ctx.feeCollector.refresh(payment)
    expect(refreshed.feeStatus).toBe('PROCESSING')
  })

  it('con comisión NONE el refresco devuelve el pago igual', async () => {
    ctx.editable.feePercentage = '0'
    const seeded = await ctx.seedLinkedUser()
    const { paymentId } = await pay(seeded)
    const payment = await stored(paymentId)
    expect(await ctx.feeCollector.refresh(payment)).toEqual(payment)
  })
})

// Caso 8
describe('cambio de porcentaje entre cotizar y confirmar', () => {
  it('se cobra con el porcentaje de la cotización; las cotizaciones nuevas usan el nuevo', async () => {
    const seeded = await ctx.seedLinkedUser()
    const quoted = bodyOf<QuoteBody>(await quote(seeded.token, '10.00'))
    ctx.editable.feePercentage = '5'

    const opts = bodyOf<OptionsBody>(
      await request(ctx.app)
        .post(`/api/v1/payments/${quoted.paymentId}/confirm/options`)
        .set(bearer(seeded.token))
    )
    const createQuote = vi.spyOn(ctx.gateway, 'createQuote')
    const res = await request(ctx.app)
      .post(`/api/v1/payments/${quoted.paymentId}/confirm`)
      .set(bearer(seeded.token))
      .send({ challengeId: opts.challengeId, credential: { id: seeded.credentialId } })
    expect(res.status).toBeLessThan(300)

    const payment = await stored(quoted.paymentId)
    expect(payment.feePercentage).toBe('1.5')
    expect(payment.fee).toEqual(usd('0.15'))
    expect(createQuote.mock.calls.at(-1)?.[0].debitAmount).toEqual(usd('0.15'))
    expect(await spent(seeded.user.id)).toBe('10.15')

    const next = bodyOf<QuoteBody>(await quote(seeded.token, '10.00'))
    expect(next.quote.fee).toEqual({ value: '0.50', assetCode: 'USD', percentage: '5' })
    expect(next.quote.totalDebit).toEqual(usd('10.50'))
  })
})

// Caso 9
describe('límite diario con comisión', () => {
  it('rechaza si el total supera el disponible aunque el pago solo no lo supere', async () => {
    const seeded = await ctx.seedLinkedUser()
    // 199.50 + 3.00 (1,5 % hacia arriba) = 202.50 > 200.00 de límite diario
    const res = await quote(seeded.token, '199.50')
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('DAILY_LIMIT_EXCEEDED')

    ctx.editable.feePercentage = '0'
    expect((await quote(seeded.token, '199.50')).status).toBe(201)
  })
})
