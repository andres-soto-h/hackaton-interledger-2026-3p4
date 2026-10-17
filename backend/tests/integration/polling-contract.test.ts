import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PaymentStatus } from '../../src/modules/payments/payment.types.js'
import type { WalletLinkStatus } from '../../src/modules/wallet-links/wallet-link.types.js'
import { bodyOf } from '../helpers/body.js'
import {
  buildTransactionsContext,
  type TransactionsContext
} from '../helpers/transactions-context.js'
import {
  buildWalletLinksContext,
  type WalletLinksContext
} from '../helpers/wallet-links-context.js'

interface PollBody {
  status: string
  isFinal: boolean
}

describe('contrato de polling · pago (GET /api/v1/payments/{id})', () => {
  let ctx: TransactionsContext
  beforeEach(() => {
    ctx = buildTransactionsContext()
  })

  const seedWithStatus = async (status: PaymentStatus) => {
    const seeded = await ctx.seedLinkedUser()
    const payment = ctx.makePayment({
      id: `pay_01J0POLL${status.padEnd(18, '0').slice(0, 18)}`,
      userId: seeded.user.id,
      walletLinkId: seeded.linkId,
      senderWalletAddress: seeded.user.walletAddress,
      status,
      ...(status === 'COMPLETED' || status === 'FAILED' || status === 'PROCESSING'
        ? {}
        : { sentAmount: undefined })
    })
    await ctx.payments.createPayment(payment)
    return { seeded, payment }
  }

  // Caso 1
  it('AWAITING_CONFIRMATION: isFinal=false y Retry-After: 5', async () => {
    const { seeded, payment } = await seedWithStatus('AWAITING_CONFIRMATION')
    const res = await ctx.get(`/api/v1/payments/${payment.id}`, seeded.token)
    expect(res.status).toBe(200)
    expect(bodyOf<PollBody>(res)).toMatchObject({
      status: 'AWAITING_CONFIRMATION',
      isFinal: false
    })
    expect(res.headers['retry-after']).toBe('5')
  })

  it('PROCESSING: isFinal=false y Retry-After: 2', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    const res = await ctx.get(`/api/v1/payments/${payment.id}`, seeded.token)
    expect(res.status).toBe(200)
    expect(bodyOf<PollBody>(res)).toMatchObject({ status: 'PROCESSING', isFinal: false })
    expect(res.headers['retry-after']).toBe('2')
  })

  // Caso 2
  it.each(['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const)(
    '%s: isFinal=true y sin Retry-After',
    async (status) => {
      const { seeded, payment } = await seedWithStatus(status)
      const res = await ctx.get(`/api/v1/payments/${payment.id}`, seeded.token)
      expect(res.status).toBe(200)
      expect(bodyOf<PollBody>(res)).toMatchObject({ status, isFinal: true })
      expect(res.headers['retry-after']).toBeUndefined()
    }
  )

  it('un pago que termina al refrescar responde isFinal=true sin Retry-After', async () => {
    const seeded = await ctx.seedLinkedUser()
    const payment = await ctx.startPayment(seeded, '25.00')
    ctx.gateway.completeOutgoingPayment(payment.outgoingPaymentUrl ?? '')
    const res = await ctx.get(`/api/v1/payments/${payment.id}`, seeded.token)
    expect(bodyOf<PollBody>(res)).toMatchObject({ status: 'COMPLETED', isFinal: true })
    expect(res.headers['retry-after']).toBeUndefined()
  })
})

describe('contrato de polling · vinculación (GET /api/v1/me/wallet-link)', () => {
  let ctx: WalletLinksContext
  beforeEach(() => {
    ctx = buildWalletLinksContext()
  })

  const link = async (status?: WalletLinkStatus) => {
    const { token } = await ctx.seedUser()
    const started = bodyOf<{ linkId: string }>(
      await request(ctx.app)
        .post('/api/v1/me/wallet-link')
        .set('authorization', `Bearer ${token}`)
    )
    if (status !== undefined) {
      await ctx.links.update(started.linkId, { status })
    }
    return {
      token,
      res: await request(ctx.app)
        .get('/api/v1/me/wallet-link')
        .set('authorization', `Bearer ${token}`)
    }
  }

  // Caso 3
  it.each(['PENDING_AUTHORIZATION', 'AUTHORIZING'] as const)(
    '%s se muestra PENDING_AUTHORIZATION: isFinal=false y Retry-After: 5',
    async (status) => {
      const { res } = await link(status)
      expect(res.status).toBe(200)
      expect(bodyOf<PollBody>(res)).toMatchObject({
        status: 'PENDING_AUTHORIZATION',
        isFinal: false
      })
      expect(res.headers['retry-after']).toBe('5')
    }
  )

  it.each(['ACTIVE', 'REJECTED', 'EXPIRED', 'REVOKED'] as const)(
    '%s: isFinal=true y sin Retry-After',
    async (status) => {
      const { res } = await link(status)
      expect(res.status).toBe(200)
      expect(bodyOf<PollBody>(res)).toMatchObject({ status, isFinal: true })
      expect(res.headers['retry-after']).toBeUndefined()
    }
  )
})
