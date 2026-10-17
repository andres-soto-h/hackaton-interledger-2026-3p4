import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bodyOf } from '../helpers/body.js'
import { buildAuthContext } from '../helpers/auth-context.js'
import {
  buildPaymentsContext,
  type PaymentsContext
} from '../helpers/payments-context.js'
import type {
  ActivityEvent,
  ActivityLog
} from '../../src/shared/activity/activity-log.js'
import { createInMemoryActivityLog } from '../../src/shared/activity/in-memory-activity-log.js'

const BOB = 'https://ilp.interledger-test.dev/bob'
const REQUEST_ID = '3f1c2b4e-8a5d-4c1e-9b7a-0d6f5e4c3b2a'

interface QuoteBody {
  paymentId: string
}
interface OptionsBody {
  challengeId: string
}

const eventsOf = async (log: ActivityLog): Promise<ActivityEvent[]> =>
  (await log.list({ limit: 100 })).items
const typesOf = (events: ActivityEvent[]): string[] => events.map((e) => e.type)

let activityLog: ActivityLog
let ctx: PaymentsContext
beforeEach(() => {
  activityLog = createInMemoryActivityLog({ now: () => Date.UTC(2026, 9, 17, 10, 0, 0) })
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const quote = (token: string, value = '25.00', requestId = REQUEST_ID) =>
  request(ctx.app)
    .post('/api/v1/payments')
    .set(bearer(token))
    .set('x-request-id', requestId)
    .send({
      type: 'p2p',
      receiverWalletAddress: BOB,
      amount: { value, assetCode: 'USD' }
    })
const confirmFlow = async (
  seeded: { token: string; credentialId: string },
  paymentId: string,
  requestId = REQUEST_ID
) => {
  const opts = bodyOf<OptionsBody>(
    await request(ctx.app)
      .post(`/api/v1/payments/${paymentId}/confirm/options`)
      .set(bearer(seeded.token))
  )
  return request(ctx.app)
    .post(`/api/v1/payments/${paymentId}/confirm`)
    .set(bearer(seeded.token))
    .set('x-request-id', requestId)
    .send({ challengeId: opts.challengeId, credential: { id: seeded.credentialId } })
}

// Caso 1
describe('eventos de un pago completo', () => {
  it('cotizar y confirmar emite los eventos en orden, con paymentId y requestId', async () => {
    ctx = buildPaymentsContext({ activityLog })
    const seeded = await ctx.seedLinkedUser()
    const before = (await eventsOf(activityLog)).length

    const q = bodyOf<QuoteBody>(await quote(seeded.token))
    const res = await confirmFlow(seeded, q.paymentId)
    expect(res.status).toBe(202)

    const events = (await eventsOf(activityLog)).slice(before)
    expect(typesOf(events)).toEqual([
      'payment.quoted',
      'payment.confirmed',
      'payment.outgoing_created'
    ])
    for (const event of events) {
      expect(event.paymentId).toBe(q.paymentId)
      expect(event.requestId).toBe(REQUEST_ID)
      expect(event.level).toBe('info')
    }
    expect(JSON.stringify(events)).not.toMatch(/token|nonce|Bearer/i)
  })

  it('cancelar un pago emite payment.cancelled en nivel warn', async () => {
    ctx = buildPaymentsContext({ activityLog })
    const seeded = await ctx.seedLinkedUser()
    const q = bodyOf<QuoteBody>(await quote(seeded.token))
    await request(ctx.app)
      .post(`/api/v1/payments/${q.paymentId}/cancel`)
      .set(bearer(seeded.token))
    const cancelled = (await eventsOf(activityLog)).find(
      (e) => e.type === 'payment.cancelled'
    )
    expect(cancelled).toMatchObject({ level: 'warn', paymentId: q.paymentId })
  })

  it('superar el monto diario emite payment.daily_limit_exceeded en nivel warn', async () => {
    ctx = buildPaymentsContext({ activityLog })
    const seeded = await ctx.seedLinkedUser()
    const res = await quote(seeded.token, '250.00')
    expect(res.status).toBe(422)
    const event = (await eventsOf(activityLog)).find(
      (e) => e.type === 'payment.daily_limit_exceeded'
    )
    expect(event).toMatchObject({ level: 'warn', requestId: REQUEST_ID })
  })

  it('el cobro de la comisión emite fee.collected con el pago', async () => {
    ctx = buildPaymentsContext({ activityLog, fees: 'real' })
    const seeded = await ctx.seedLinkedUser()
    const q = bodyOf<QuoteBody>(await quote(seeded.token))
    expect((await confirmFlow(seeded, q.paymentId)).status).toBe(202)
    const fee = (await eventsOf(activityLog)).find((e) => e.type === 'fee.collected')
    expect(fee).toMatchObject({ level: 'info', paymentId: q.paymentId })
  })
})

describe('eventos de la vinculación de wallet', () => {
  it('vincular emite requested, callback_received y active', async () => {
    ctx = buildPaymentsContext({ activityLog })
    await ctx.seedLinkedUser()
    expect(typesOf(await eventsOf(activityLog))).toEqual([
      'wallet_link.requested',
      'wallet_link.callback_received',
      'wallet_link.active'
    ])
  })

  // Caso 2
  it('un callback con hash inválido emite wallet_link.callback_invalid en nivel warn', async () => {
    ctx = buildPaymentsContext({ activityLog })
    const seeded = await ctx.seedUser()
    const started = await ctx.walletLinks.start(seeded.user)
    const error = await ctx.walletLinks
      .handleCallback({ linkId: started.linkId, interactRef: 'ref-1', hash: 'AAAA' })
      .then(
        () => null,
        (e: unknown) => e
      )
    expect(error).not.toBeNull()
    const events = await eventsOf(activityLog)
    const invalid = events.find((e) => e.type === 'wallet_link.callback_invalid')
    expect(invalid).toMatchObject({ level: 'warn' })
    expect(JSON.stringify(events)).not.toContain('AAAA')
    expect(JSON.stringify(events)).not.toContain('ref-1')
  })
})

describe('eventos de cuentas', () => {
  it('registrar una cuenta emite user.registered', async () => {
    const auth = buildAuthContext({ activityLog })
    const options = bodyOf<OptionsBody>(
      await request(auth.app)
        .post('/api/v1/auth/register/options')
        .send({ displayName: 'Alice', walletAddress: '$ilp.interledger-test.dev/alice' })
    )
    const res = await request(auth.app)
      .post('/api/v1/auth/register/verify')
      .send({ challengeId: options.challengeId, credential: { id: 'cred-1' } })
    expect(res.status).toBe(200)
    const event = (await eventsOf(activityLog)).find((e) => e.type === 'user.registered')
    expect(event?.data).toEqual({ userId: bodyOf<{ user: { id: string } }>(res).user.id })
  })

  it('borrar la cuenta emite user.deleted', async () => {
    const auth = buildAuthContext({ activityLog })
    const seeded = await auth.seedUser()
    const res = await request(auth.app).delete('/api/v1/me').set(bearer(seeded.token))
    expect(res.status).toBe(204)
    const event = (await eventsOf(activityLog)).find((e) => e.type === 'user.deleted')
    expect(event?.data).toEqual({ userId: seeded.user.id })
  })
})

// Caso 4
describe('un ActivityLog que falla no rompe el pago', () => {
  it('cotiza y confirma con normalidad y deja el aviso en el log técnico', async () => {
    const failing: ActivityLog = {
      record: () => Promise.reject(new Error('dynamo down')),
      list: () => Promise.resolve({ items: [] })
    }
    const activityLogger = { warn: vi.fn() }
    ctx = buildPaymentsContext({ activityLog: failing, activityLogger })
    const seeded = await ctx.seedLinkedUser()
    const q = await quote(seeded.token)
    expect(q.status).toBe(201)
    const res = await confirmFlow(seeded, bodyOf<QuoteBody>(q).paymentId)
    expect(res.status).toBe(202)
    expect(activityLogger.warn).toHaveBeenCalled()
  })
})
