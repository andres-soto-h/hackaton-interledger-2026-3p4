import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createComposition } from '../../src/composition/create-composition.js'
import { createMemoryStorage } from '../../src/composition/storage.js'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import { errorOf } from '../helpers/errors.js'
import { bodyOf } from '../helpers/body.js'
import { testConfig, testSecrets } from '../helpers/app.js'
import { wallet } from '../helpers/auth-context.js'
import { cookieHeader, csrfOf, mergeCookies } from '../helpers/admin.js'
import { createFakePasskeyVerifier } from '../helpers/fake-passkey-verifier.js'
import { captureLogs } from '../helpers/log-capture.js'

// Cableado de los specs 024 (comisión) y 008 (consultas) en la composición.
const build = (feePercentage = '1') => {
  const gateway = createFakeOpenPaymentsGateway()
  for (const name of ['alice', 'shop']) gateway.addWallet(wallet(name))
  const storage = createMemoryStorage()
  const app = createComposition({
    config: { ...testConfig, feePercentage },
    secrets: testSecrets,
    logger: captureLogs().logger,
    gateway,
    verifier: createFakePasskeyVerifier(),
    storage,
    publicApiUrl: 'http://localhost:3000'
  })
  return { app, gateway, storage }
}
type Built = ReturnType<typeof build>

const registerWithLink = async ({ app, storage }: Built) => {
  const options = await request(app)
    .post('/api/v1/auth/register/options')
    .send({ displayName: 'Alice', walletAddress: wallet('alice').id })
  const challengeId = bodyOf<{ challengeId: string }>(options).challengeId
  const verified = await request(app)
    .post('/api/v1/auth/register/verify')
    .send({ challengeId, credential: { id: 'cred-1' } })
  const token = bodyOf<{ session: { token: string } }>(verified).session.token
  const bearer = { authorization: `Bearer ${token}` }
  const me = await request(app).get('/api/v1/me').set(bearer)
  await storage.walletLinks.create({
    id: 'wl_01TESTLINK',
    userId: bodyOf<{ id: string }>(me).id,
    walletAddress: wallet('alice').id,
    assetCode: 'USD',
    assetScale: 2,
    dailyLimit: '200',
    interval: 'R/2026-10-17T05:00:00Z/P1D',
    periodTimezone: 'America/Bogota',
    status: 'ACTIVE',
    continueUri: 'https://auth.interledger-test.dev/continue/c1',
    continueToken: 'continue-token',
    tokenVersion: 1,
    createdAt: '2026-10-17T10:00:00.000Z'
  })
  return bearer
}

const quote = (built: Built, bearer: Record<string, string>) =>
  request(built.app)
    .post('/api/v1/payments')
    .set(bearer)
    .send({
      type: 'p2p',
      receiverWalletAddress: wallet('shop').id,
      amount: { value: '10.00', assetCode: 'USD' }
    })

describe('composición · consultas (spec 008)', () => {
  it.each([
    ['/api/v1/transactions'],
    ['/api/v1/payments/pay_01JTESTPAYMENT000000000000']
  ])('GET %s exige la sesión del usuario, no la API key', async (path) => {
    const res = await request(build().app).get(path)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })

  it('GET /api/v1/payments/{id} y /transactions muestran el pago cotizado', async () => {
    const built = build()
    const bearer = await registerWithLink(built)
    const created = await quote(built, bearer)
    expect(created.status).toBe(201)
    const paymentId = bodyOf<{ paymentId: string }>(created).paymentId

    const status = await request(built.app)
      .get(`/api/v1/payments/${paymentId}`)
      .set(bearer)
    expect(status.status).toBe(200)
    expect(bodyOf<{ paymentId: string; status: string }>(status)).toMatchObject({
      paymentId,
      status: 'AWAITING_CONFIRMATION'
    })

    const list = await request(built.app).get('/api/v1/transactions').set(bearer)
    expect(list.status).toBe(200)
    const items = bodyOf<{ items: { id: string }[] }>(list).items
    expect(items.map((item) => item.id)).toContain(paymentId)
  })

  it('no deja ver el pago de otro usuario', async () => {
    const built = build()
    const bearer = await registerWithLink(built)
    const paymentId = bodyOf<{ paymentId: string }>(await quote(built, bearer)).paymentId
    const other = await request(built.app)
      .get(`/api/v1/payments/${paymentId}`)
      .set({ authorization: 'Bearer not-a-session' })
    expect(other.status).toBe(401)
  })
})

describe('composición · comisión (spec 024)', () => {
  it('con FEE_PERCENTAGE=1 la cotización incluye la comisión en el total', async () => {
    const built = build('1')
    const bearer = await registerWithLink(built)
    const res = await quote(built, bearer)
    expect(res.status).toBe(201)
    const quoteBody = bodyOf<{
      quote: { fee: { value: string }; totalDebit: { value: string } }
    }>(res).quote
    expect(quoteBody.fee.value).toBe('0.10')
    expect(quoteBody.totalDebit.value).toBe('10.10')
  })

  it('con FEE_PERCENTAGE=0 no hay comisión', async () => {
    const built = build('0')
    const bearer = await registerWithLink(built)
    const res = await quote(built, bearer)
    const quoteBody = bodyOf<{ quote: { totalDebit: { value: string } } }>(res).quote
    expect(quoteBody.totalDebit.value).toBe('10.00')
  })

  it('el inicio del panel muestra las comisiones cobradas del almacenamiento', async () => {
    const built = build()
    const bearer = await registerWithLink(built)
    const paymentId = bodyOf<{ paymentId: string }>(await quote(built, bearer)).paymentId
    await built.storage.payments.updatePayment(
      paymentId,
      { feeStatus: 'COLLECTED' },
      { expectedStatus: 'AWAITING_CONFIRMATION' }
    )

    const form = await request(built.app).get('/admin/login')
    const preCookie = cookieHeader(form)
    const login = await request(built.app)
      .post('/admin/login')
      .type('form')
      .set('cookie', preCookie)
      .send({ password: testSecrets.adminPassword, _csrf: csrfOf(form.text) })
    expect(login.status).toBe(302)
    const cookie = mergeCookies(preCookie, cookieHeader(login))

    const home = await request(built.app).get('/admin').set('cookie', cookie)
    expect(home.status).toBe(200)
    expect(home.text).toContain('Comisiones cobradas')
    expect(home.text).toContain('0.10')
  })
})
