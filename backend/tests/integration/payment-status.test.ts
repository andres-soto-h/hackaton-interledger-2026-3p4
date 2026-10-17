import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/shared/errors/app-error.js'
import type { Amount } from '../../src/shared/money/types.js'
import { TEST_API_KEY } from '../helpers/app.js'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import {
  buildTransactionsContext,
  usd,
  type TransactionsContext
} from '../helpers/transactions-context.js'

interface StatusBody {
  paymentId: string
  type: string
  status: string
  senderWalletAddress: string
  receiverWalletAddress: string
  debitAmount: Amount
  receiveAmount: Amount
  sentAmount: Amount | null
  fee: Amount & { percentage: string }
  feeStatus: string
  totalDebit: Amount
  description: string | null
  error: { code: string; message: string } | null
  stale?: boolean
  createdAt: string
  updatedAt: string
}

let ctx: TransactionsContext

beforeEach(() => {
  ctx = buildTransactionsContext()
})

const status = (id: string, token?: string) => ctx.get(`/api/v1/payments/${id}`, token)
const spent = async (userId: string): Promise<string> =>
  (await ctx.walletLinks.getAllowance(userId)).spent.value

const outgoingUrlOf = (payment: { outgoingPaymentUrl?: string }): string => {
  if (payment.outgoingPaymentUrl === undefined) throw new Error('no outgoing payment')
  return payment.outgoingPaymentUrl
}

// Casos 1, 2 y 3
describe('GET /api/v1/payments/{paymentId} · pago en PROCESSING', () => {
  it('caso 1: el outgoing payment terminó → COMPLETED, guardado, leído con el token de la vinculación, reserva ajustada', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    expect(await spent(seeded.user.id)).toBe('25.38') // débito 25.00 + comisión 0.38 reservados
    ctx.gateway.completeOutgoingPayment(outgoingUrlOf(payment))
    const spy = vi.spyOn(ctx.gateway, 'getOutgoingPayment')

    const res = await status(payment.id, seeded.token)

    expect(res.status).toBe(200)
    const body = bodyOf<StatusBody>(res)
    expect(body).toMatchObject({
      paymentId: payment.id,
      type: 'p2p',
      status: 'COMPLETED',
      senderWalletAddress: seeded.user.walletAddress,
      debitAmount: usd('25.00'),
      sentAmount: usd('25.00'),
      fee: { value: '0.38', assetCode: 'USD', percentage: '1.5' },
      totalDebit: usd('25.38'),
      description: 'Almuerzo',
      error: null
    })
    expect(body.stale).toBeUndefined()
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]?.[0].url).toBe(outgoingUrlOf(payment))
    expect(spy.mock.calls[0]?.[0].accessToken.length).toBeGreaterThan(0)
    expect((await ctx.payments.getPayment(payment.id))?.status).toBe('COMPLETED')
    // Se gastó exactamente lo reservado: no se libera nada.
    expect(await spent(seeded.user.id)).toBe('25.38')
  })

  it('caso 2: el outgoing payment falló → FAILED y se libera toda la reserva', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    ctx.gateway.failOutgoingPayment(outgoingUrlOf(payment))

    const res = await status(payment.id, seeded.token)

    expect(res.status).toBe(200)
    const body = bodyOf<StatusBody>(res)
    expect(body.status).toBe('FAILED')
    expect(body.error).not.toBeNull()
    expect((await ctx.payments.getPayment(payment.id))?.status).toBe('FAILED')
    expect(await spent(seeded.user.id)).toBe('0.00')
  })

  it('caso 3: el outgoing payment sigue en curso → sigue PROCESSING y no cambia la reserva', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')

    const res = await status(payment.id, seeded.token)

    expect(bodyOf<StatusBody>(res).status).toBe('PROCESSING')
    expect(bodyOf<StatusBody>(res).sentAmount).toBeNull()
    expect((await ctx.payments.getPayment(payment.id))?.status).toBe('PROCESSING')
    expect(await spent(seeded.user.id)).toBe('25.38')
  })

  it('al completarse reintenta la comisión que había fallado (una sola vez)', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    await ctx.payments.updatePayment(
      payment.id,
      { feeStatus: 'FAILED' },
      { expectedStatus: 'PROCESSING' }
    )
    const collect = vi.fn(() => Promise.resolve())
    ctx.feeCollector.collect = collect
    ctx.gateway.completeOutgoingPayment(outgoingUrlOf(payment))

    await status(payment.id, seeded.token)
    await status(payment.id, seeded.token)

    expect(collect).toHaveBeenCalledOnce()
  })

  it('al completarse no reintenta la comisión si ya se cobró', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    await ctx.payments.updatePayment(
      payment.id,
      { feeStatus: 'COLLECTED' },
      { expectedStatus: 'PROCESSING' }
    )
    const collect = vi.fn(() => Promise.resolve())
    ctx.feeCollector.collect = collect
    ctx.gateway.completeOutgoingPayment(outgoingUrlOf(payment))

    await status(payment.id, seeded.token)

    expect(collect).not.toHaveBeenCalled()
  })
})

// Caso 4
describe('GET /api/v1/payments/{paymentId} · quote vencido', () => {
  it('caso 4: AWAITING_CONFIRMATION con el quote vencido → EXPIRED y guardado', async () => {
    const seeded = await ctx.seedLinkedUser()
    const created = ctx.makePayment({
      id: 'pay_01JCAWAITINGAWAITINGAWAIT0',
      userId: seeded.user.id,
      walletLinkId: seeded.linkId,
      senderWalletAddress: seeded.user.walletAddress,
      status: 'AWAITING_CONFIRMATION',
      feeStatus: 'PENDING',
      sentAmount: undefined
    })
    await ctx.payments.createPayment(created)
    ctx.advanceSeconds(10 * 60)

    const res = await status(created.id, seeded.token)

    expect(bodyOf<StatusBody>(res).status).toBe('EXPIRED')
    expect((await ctx.payments.getPayment(created.id))?.status).toBe('EXPIRED')
  })

  it('con el quote vigente sigue AWAITING_CONFIRMATION', async () => {
    const seeded = await ctx.seedLinkedUser()
    const created = ctx.makePayment({
      id: 'pay_01JCAWAITINGAWAITINGAWAIT0',
      userId: seeded.user.id,
      walletLinkId: seeded.linkId,
      senderWalletAddress: seeded.user.walletAddress,
      status: 'AWAITING_CONFIRMATION',
      feeStatus: 'PENDING',
      sentAmount: undefined
    })
    await ctx.payments.createPayment(created)

    const res = await status(created.id, seeded.token)

    expect(bodyOf<StatusBody>(res).status).toBe('AWAITING_CONFIRMATION')
  })
})

// Caso 5
describe('GET /api/v1/payments/{paymentId} · estado final', () => {
  it.each(['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const)(
    'caso 5: un pago %s no llama a Open Payments',
    async (final) => {
      const seeded = await ctx.seedLinkedUser()
      const created = ctx.makePayment({
        id: 'pay_01JCFINALFINALFINALFINALFI',
        userId: seeded.user.id,
        walletLinkId: seeded.linkId,
        senderWalletAddress: seeded.user.walletAddress,
        status: final,
        outgoingPaymentUrl: 'https://ilp.interledger-test.dev/outgoing-payments/x'
      })
      await ctx.payments.createPayment(created)
      const spies = [
        vi.spyOn(ctx.gateway, 'getOutgoingPayment'),
        vi.spyOn(ctx.gateway, 'getIncomingPayment'),
        vi.spyOn(ctx.gateway, 'rotateToken')
      ]

      const res = await status(created.id, seeded.token)

      expect(res.status).toBe(200)
      expect(bodyOf<StatusBody>(res).status).toBe(final)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    }
  )

  it('un pago que acaba de terminar no vuelve a consultar el gateway', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    ctx.gateway.completeOutgoingPayment(outgoingUrlOf(payment))
    const spy = vi.spyOn(ctx.gateway, 'getOutgoingPayment')

    await status(payment.id, seeded.token)
    await status(payment.id, seeded.token)

    expect(spy).toHaveBeenCalledOnce()
  })
})

// Caso 6
describe('GET /api/v1/payments/{paymentId} · acceso', () => {
  it('caso 6: un paymentId inexistente → 404 PAYMENT_NOT_FOUND', async () => {
    const seeded = await ctx.seedLinkedUser()
    const res = await status('pay_01JCNOEXISTENOEXISTENOEXIS', seeded.token)
    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('PAYMENT_NOT_FOUND')
  })

  it('caso 6: el pago de otro usuario → 404 PAYMENT_NOT_FOUND y sin llamadas al gateway', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const bob = await ctx.seedUser('bob')
    const payment = await ctx.startPayment(alice, '25.00')
    const spy = vi.spyOn(ctx.gateway, 'getOutgoingPayment')

    const res = await status(payment.id, bob.token)

    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('PAYMENT_NOT_FOUND')
    expect(spy).not.toHaveBeenCalled()
  })

  it('exige la sesión del usuario: sin sesión, con API key o con una sesión inválida → 401', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    const path = `/api/v1/payments/${payment.id}`

    const none = await ctx.get(path)
    const apiKey = await ctx.get(path).set('x-api-key', TEST_API_KEY)
    const garbage = await ctx.get(path, 'not-a-token')

    for (const res of [none, apiKey, garbage]) {
      expect(res.status).toBe(401)
      expect(errorOf(res).code).toBe('SESSION_INVALID')
    }
  })
})

// Caso 7
describe('GET /api/v1/payments/{paymentId} · Open Payments no responde', () => {
  it('caso 7: devuelve el último estado guardado con stale: true', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    ctx.gateway.failNext(
      'getOutgoingPayment',
      new AppError(503, 'OPEN_PAYMENTS_UNAVAILABLE', 'down')
    )

    const res = await status(payment.id, seeded.token)

    expect(res.status).toBe(200)
    const body = bodyOf<StatusBody>(res)
    expect(body.status).toBe('PROCESSING')
    expect(body.stale).toBe(true)
    expect((await ctx.payments.getPayment(payment.id))?.status).toBe('PROCESSING')
    expect(await spent(seeded.user.id)).toBe('25.38')
  })

  it('si la vinculación fue revocada también devuelve el estado guardado con stale: true', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    ctx.gateway.revokeGrants()

    const res = await status(payment.id, seeded.token)

    expect(res.status).toBe(200)
    expect(bodyOf<StatusBody>(res).stale).toBe(true)
  })
})
