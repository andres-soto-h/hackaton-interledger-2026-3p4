import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Amount } from '../../src/shared/money/types.js'
import { TEST_API_KEY } from '../helpers/app.js'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import {
  ALICE,
  BOB,
  buildTransactionsContext,
  EPM,
  GHOST,
  SHOP,
  usd,
  type TransactionsContext
} from '../helpers/transactions-context.js'

interface Item {
  id: string
  kind: 'payment' | 'payment-request'
  direction: 'incoming' | 'outgoing'
  type: string
  status: string
  counterparty: {
    name: string | null
    walletAddress: string
    merchantId: string | null
  } | null
  debitAmount: Amount | null
  receiveAmount: Amount | null
  fee: (Amount & { percentage: string }) | null
  totalDebit: Amount | null
  description: string | null
  createdAt: string
  updatedAt: string
}
interface Page {
  items: Item[]
  nextCursor: string | null
}

let ctx: TransactionsContext

beforeEach(() => {
  ctx = buildTransactionsContext()
})

const list = (token: string | undefined, query = '') =>
  ctx.get(`/api/v1/transactions${query}`, token)
const page = async (token: string, query = ''): Promise<Page> => {
  const res = await list(token, query)
  expect(res.status).toBe(200)
  return bodyOf<Page>(res)
}
const ids = (p: Page) => p.items.map((item) => item.id)

/** Seeds alice (linked) with three outgoing payments and a pending incoming request. */
const seedHistory = async () => {
  const alice = await ctx.seedLinkedUser('alice')
  const bob = await ctx.seedUser('bob')
  const first = await ctx.startPayment(alice, '10.00', BOB)
  ctx.advanceSeconds(60)
  const second = await ctx.startPayment(alice, '11.00', BOB)
  ctx.advanceSeconds(60)
  const third = await ctx.startPayment(alice, '12.00', SHOP)
  ctx.advanceSeconds(60)
  const request = ctx.makeRequest({ id: 'pr_01JCREQUESTREQUESTREQUESTA' })
  await ctx.payments.createPaymentRequest(request)
  return { alice, bob, first, second, third, request }
}

// Caso 8
describe('GET /api/v1/transactions · listado', () => {
  it('caso 8: all trae los pagos de la wallet (emisor) y sus solicitudes, del más reciente al más antiguo', async () => {
    const h = await seedHistory()

    const result = await page(h.alice.token)

    expect(ids(result)).toEqual([h.request.id, h.third.id, h.second.id, h.first.id])
    expect(result.nextCursor).toBeNull()
  })

  it('caso 8: direction outgoing / incoming', async () => {
    const h = await seedHistory()

    const outgoing = await page(h.alice.token, '?direction=outgoing')
    const incomingAlice = await page(h.alice.token, '?direction=incoming')
    const incomingBob = await page(h.bob.token, '?direction=incoming')

    expect(ids(outgoing)).toEqual([h.third.id, h.second.id, h.first.id])
    expect(outgoing.items.every((i) => i.direction === 'outgoing')).toBe(true)
    expect(ids(incomingAlice)).toEqual([h.request.id])
    expect(ids(incomingBob)).toEqual([h.second.id, h.first.id])
    expect(incomingBob.items.every((i) => i.direction === 'incoming')).toBe(true)
  })

  it('caso 8: kind y status', async () => {
    const h = await seedHistory()
    ctx.gateway.completeOutgoingPayment(h.first.outgoingPaymentUrl ?? '')

    const payments = await page(h.alice.token, '?kind=payment')
    const requests = await page(h.alice.token, '?kind=payment-request')
    const processing = await page(h.alice.token, '?status=PROCESSING')
    const completed = await page(h.alice.token, '?status=COMPLETED')

    expect(ids(payments)).toEqual([h.third.id, h.second.id, h.first.id])
    expect(ids(requests)).toEqual([h.request.id])
    expect(ids(processing)).toEqual([h.third.id, h.second.id])
    // El filtro usa el estado guardado: el pago terminado todavía no se ha refrescado.
    expect(ids(completed)).toEqual([])
  })

  it('un usuario sin transacciones recibe una lista vacía', async () => {
    const lonely = await ctx.seedUser('shop')
    expect(await page(lonely.token)).toEqual({ items: [], nextCursor: null })
  })

  it('los elementos no finales propios se refrescan antes de responder', async () => {
    const h = await seedHistory()
    ctx.gateway.completeOutgoingPayment(h.second.outgoingPaymentUrl ?? '')
    ctx.gateway.failOutgoingPayment(h.third.outgoingPaymentUrl ?? '')

    const result = await page(h.alice.token, '?kind=payment')

    expect(result.items.map((i) => [i.id, i.status])).toEqual([
      [h.third.id, 'FAILED'],
      [h.second.id, 'COMPLETED'],
      [h.first.id, 'PROCESSING']
    ])
    expect((await ctx.payments.getPayment(h.second.id))?.status).toBe('COMPLETED')
  })

  it('no refresca los pagos que el usuario recibe (el token es del emisor)', async () => {
    const h = await seedHistory()
    const spy = vi.spyOn(ctx.gateway, 'getOutgoingPayment')

    const result = await page(h.bob.token, '?direction=incoming')

    expect(result.items).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()
  })

  it('refresca como máximo 5 elementos a la vez', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    for (let i = 0; i < 8; i++) {
      await ctx.payments.createPayment(
        ctx.makePayment({
          id: `pay_01JCCONCURRENCY${String(i).padStart(11, '0')}`,
          userId: alice.user.id,
          walletLinkId: alice.linkId,
          senderWalletAddress: alice.user.walletAddress,
          status: 'PROCESSING',
          feeStatus: 'PENDING',
          sentAmount: undefined,
          outgoingPaymentUrl: `https://ilp.interledger-test.dev/outgoing-payments/c${i}`
        })
      )
    }
    let inFlight = 0
    let peak = 0
    const spy = vi
      .spyOn(ctx.gateway, 'getOutgoingPayment')
      .mockImplementation(async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 15))
        inFlight -= 1
        return {
          id: 'x',
          walletAddress: alice.user.walletAddress,
          quoteId: 'q',
          receiver: 'r',
          debitAmount: usd('10.00'),
          receiveAmount: usd('10.00'),
          sentAmount: usd('0.00'),
          failed: false
        }
      })

    const result = await page(alice.token)

    expect(result.items).toHaveLength(8)
    expect(spy).toHaveBeenCalledTimes(8)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
  })

  it('si Open Payments falla al refrescar, la lista responde con el estado guardado', async () => {
    const h = await seedHistory()
    vi.spyOn(ctx.gateway, 'getOutgoingPayment').mockRejectedValue(new Error('down'))

    const result = await page(h.alice.token, '?kind=payment')

    expect(result.items.map((i) => i.status)).toEqual([
      'PROCESSING',
      'PROCESSING',
      'PROCESSING'
    ])
  })
})

// Caso 9
describe('GET /api/v1/transactions · paginación', () => {
  it('caso 9: recorrer con cursor no repite ni omite elementos', async () => {
    const h = await seedHistory()
    const expected = [h.request.id, h.third.id, h.second.id, h.first.id]

    const first = await page(h.alice.token, '?limit=3')
    expect(first.items).toHaveLength(3)
    expect(first.nextCursor).not.toBeNull()
    const second = await page(
      h.alice.token,
      `?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? '')}`
    )
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()

    expect([...ids(first), ...ids(second)]).toEqual(expected)
  })

  it('caso 9: el cursor se combina con los filtros', async () => {
    const h = await seedHistory()
    const first = await page(h.alice.token, '?kind=payment&limit=2')
    const second = await page(
      h.alice.token,
      `?kind=payment&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`
    )
    expect([...ids(first), ...ids(second)]).toEqual([h.third.id, h.second.id, h.first.id])
  })
})

// Caso 10
describe('GET /api/v1/transactions · solicitudes de pago', () => {
  it('caso 10: una solicitud con el incoming payment completado → COMPLETED y guardada', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const request = ctx.makeRequest({ id: 'pr_01JCPAIDPAIDPAIDPAIDPAIDPA' })
    await ctx.payments.createPaymentRequest(request)
    vi.spyOn(ctx.gateway, 'getIncomingPayment').mockResolvedValue({
      id: request.incomingPaymentUrl,
      walletAddress: ALICE,
      incomingAmount: usd('25.00'),
      receivedAmount: usd('25.00'),
      completed: true
    })

    const result = await page(alice.token)

    expect(result.items.map((i) => [i.id, i.status])).toEqual([[request.id, 'COMPLETED']])
    expect((await ctx.payments.getPaymentRequest(request.id))?.status).toBe('COMPLETED')
  })

  it('caso 10: una solicitud vencida → EXPIRED sin consultar Open Payments', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const request = ctx.makeRequest({
      id: 'pr_01JCLATELATELATELATELATELA',
      expiresAt: new Date(ctx.clock.value + 60_000).toISOString()
    })
    await ctx.payments.createPaymentRequest(request)
    ctx.advanceSeconds(120)
    const spy = vi.spyOn(ctx.gateway, 'getIncomingPayment')

    const result = await page(alice.token)

    expect(result.items[0]?.status).toBe('EXPIRED')
    expect(spy).not.toHaveBeenCalled()
    expect((await ctx.payments.getPaymentRequest(request.id))?.status).toBe('EXPIRED')
  })

  it('caso 10: una solicitud todavía pendiente sigue PENDING', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const request = ctx.makeRequest({ id: 'pr_01JCSTILLSTILLSTILLSTILLST' })
    await ctx.payments.createPaymentRequest(request)
    vi.spyOn(ctx.gateway, 'getIncomingPayment').mockResolvedValue({
      id: request.incomingPaymentUrl,
      walletAddress: ALICE,
      incomingAmount: usd('25.00'),
      receivedAmount: usd('0.00'),
      completed: false
    })

    const result = await page(alice.token)

    expect(result.items[0]?.status).toBe('PENDING')
  })

  it('una solicitud llega al listado con sus datos y sin contraparte ni montos de pago', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const request = ctx.makeRequest({ id: 'pr_01JCSHAPESHAPESHAPESHAPESH' })
    await ctx.payments.createPaymentRequest(request)

    const [item] = (await page(alice.token)).items

    expect(item).toMatchObject({
      id: request.id,
      kind: 'payment-request',
      direction: 'incoming',
      type: 'p2m',
      status: 'PENDING',
      counterparty: null,
      debitAmount: null,
      receiveAmount: usd('25.00'),
      fee: null,
      totalDebit: null,
      description: 'Pedido 42'
    })
  })
})

// Caso 11
describe('GET /api/v1/transactions · acceso y validación', () => {
  it('caso 11: sin sesión → 401, también con la API key', async () => {
    const none = await list(undefined)
    const apiKey = await ctx.get('/api/v1/transactions').set('x-api-key', TEST_API_KEY)
    const garbage = await list('not-a-token')

    for (const res of [none, apiKey, garbage]) {
      expect(res.status).toBe(401)
      expect(errorOf(res).code).toBe('SESSION_INVALID')
    }
  })

  it('caso 11: walletAddress en el query → 400 VALIDATION_ERROR (la wallet es la de la cuenta)', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const res = await list(alice.token, `?walletAddress=${encodeURIComponent(BOB)}`)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  it.each(['?limit=0', '?limit=101', '?direction=sideways', '?kind=other', '?limit=abc'])(
    'caso 11: %s → 400 VALIDATION_ERROR',
    async (query) => {
      const alice = await ctx.seedLinkedUser('alice')
      const res = await list(alice.token, query)
      expect(res.status).toBe(400)
      expect(errorOf(res).code).toBe('VALIDATION_ERROR')
    }
  )

  it('un cursor corrupto → 400 VALIDATION_ERROR', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const res = await list(alice.token, '?cursor=%25%25not-a-cursor')
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  it('un usuario solo ve lo suyo: alice no ve los pagos de bob a otras wallets', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const bob = await ctx.seedLinkedUser('bob')
    await ctx.startPayment(bob, '5.00', SHOP)
    const mine = await ctx.startPayment(alice, '6.00', SHOP)

    const result = await page(alice.token)

    expect(ids(result)).toEqual([mine.id])
  })
})

// Caso 13
describe('GET /api/v1/transactions · contraparte y datos completos', () => {
  it('caso 13: un comercio del directorio → name y merchantId del directorio; todos los campos del contrato', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const payment = await ctx.startPayment(alice, '25.00', EPM.walletAddress)

    const [item] = (await page(alice.token)).items

    expect(item).toEqual({
      id: payment.id,
      kind: 'payment',
      direction: 'outgoing',
      type: 'p2p',
      status: 'PROCESSING',
      counterparty: {
        name: 'EPM',
        walletAddress: EPM.walletAddress,
        merchantId: 'mer_epm'
      },
      debitAmount: usd('25.00'),
      receiveAmount: usd('25.00'),
      fee: { value: '0.38', assetCode: 'USD', percentage: '1.5' },
      totalDebit: usd('25.38'),
      description: 'Almuerzo',
      createdAt: payment.createdAt,
      updatedAt: expect.any(String) as string
    })
  })

  it('caso 13: una wallet sin comercio → publicName de la wallet y merchantId null', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    await ctx.startPayment(alice, '25.00', SHOP)

    const [item] = (await page(alice.token)).items

    expect(item?.counterparty).toEqual({
      name: 'shop',
      walletAddress: SHOP,
      merchantId: null
    })
  })

  it('caso 13: una wallet que no se puede resolver → name null (la lista no falla)', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    await ctx.payments.createPayment(
      ctx.makePayment({
        id: 'pay_01JCGHOSTGHOSTGHOSTGHOSTGH',
        userId: alice.user.id,
        walletLinkId: alice.linkId,
        senderWalletAddress: alice.user.walletAddress,
        receiverWalletAddress: GHOST
      })
    )

    const [item] = (await page(alice.token)).items

    expect(item?.counterparty).toEqual({
      name: null,
      walletAddress: GHOST,
      merchantId: null
    })
  })

  it('en un pago recibido la contraparte es el emisor', async () => {
    const alice = await ctx.seedLinkedUser('alice')
    const bob = await ctx.seedUser('bob')
    await ctx.startPayment(alice, '25.00', BOB)

    const [item] = (await page(bob.token)).items

    expect(item).toMatchObject({
      direction: 'incoming',
      counterparty: { name: 'alice', walletAddress: ALICE, merchantId: null }
    })
  })
})
