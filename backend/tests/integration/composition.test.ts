import { Router } from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { Config, LambdaConfig } from '../../src/config/env.js'
import { createComposition } from '../../src/composition/create-composition.js'
import { createMemoryStorage } from '../../src/composition/storage.js'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import { errorOf } from '../helpers/errors.js'
import {
  openPaymentsTestConfig,
  TEST_API_KEY,
  testConfig,
  testSecrets
} from '../helpers/app.js'
import { wallet } from '../helpers/auth-context.js'
import { captureLogs } from '../helpers/log-capture.js'
import { createFakePasskeyVerifier } from '../helpers/fake-passkey-verifier.js'

const lambdaConfig: LambdaConfig = {
  ...openPaymentsTestConfig,
  storage: 'dynamo',
  runtime: 'lambda',
  nodeEnv: 'production',
  logLevel: 'silent',
  apiKeySecretArn: 'arn:api',
  openPaymentsSecretArn: 'arn:op',
  sessionSecretArn: 'arn:session',
  adminPasswordSecretArn: 'arn:admin',
  tokenKeySecretArn: 'arn:token',
  paymentsTableName: 'table'
}

const build = (
  options: {
    config?: Config
    routers?: Router[]
    publicApiUrl?: string
  } = {}
) => {
  const gateway = createFakeOpenPaymentsGateway()
  for (const name of ['alice', 'shop']) gateway.addWallet(wallet(name))
  const verifier = createFakePasskeyVerifier()
  const storage = createMemoryStorage()
  const app = createComposition({
    config: options.config ?? testConfig,
    secrets: testSecrets,
    logger: captureLogs().logger,
    gateway,
    verifier,
    storage,
    publicApiUrl: options.publicApiUrl ?? 'http://localhost:3000',
    extraRouters: options.routers
  })
  return { app, gateway, verifier, storage }
}

const keyed = (req: request.Test) => req.set('x-api-key', TEST_API_KEY)

describe('composición · rutas montadas', () => {
  it('GET /health es público', async () => {
    const { app } = build()
    expect((await request(app).get('/health')).status).toBe(200)
  })

  it('las rutas desconocidas exigen la API key (401) y con ella dan 404', async () => {
    const { app } = build()
    expect((await request(app).get('/api/v1/unknown')).status).toBe(401)
    expect((await keyed(request(app).get('/api/v1/unknown'))).status).toBe(404)
  })

  it('payment-requests está montada y exige la API key', async () => {
    const { app } = build()
    const anonymous = await request(app).post('/api/v1/payment-requests').send({})
    expect(anonymous.status).toBe(401)
    const withKey = await keyed(request(app).post('/api/v1/payment-requests')).send({})
    expect(withKey.status).toBe(400)
    expect(errorOf(withKey).code).toBe('VALIDATION_ERROR')
  })

  it('auth está montada y es pública (sin API key)', async () => {
    const { app } = build()
    const res = await request(app).post('/api/v1/auth/register/options').send({})
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  it.each([
    ['get', '/api/v1/me'],
    ['delete', '/api/v1/me'],
    ['get', '/api/v1/me/wallet-link'],
    ['post', '/api/v1/me/wallet-link'],
    ['delete', '/api/v1/me/wallet-link'],
    ['get', '/api/v1/me/allowance'],
    ['post', '/api/v1/payments'],
    ['post', '/api/v1/payments/pay_01JTESTPAYMENT000000000000/confirm/options'],
    ['post', '/api/v1/payments/pay_01JTESTPAYMENT000000000000/confirm'],
    ['post', '/api/v1/payments/pay_01JTESTPAYMENT000000000000/cancel']
  ] as const)(
    '%s %s exige la sesión del usuario, no la API key',
    async (method, path) => {
      const { app } = build()
      const res = await request(app)[method](path)
      expect(res.status).toBe(401)
      expect(errorOf(res).code).toBe('SESSION_INVALID')
    }
  )

  it('el callback de Open Payments está montado y es público', async () => {
    const { app } = build()
    const res = await request(app).get('/api/v1/auth/callback')
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  it('los routers extra (p. ej. el spec 007) se montan después de los módulos', async () => {
    const extra = Router()
    extra.get('/api/v1/extra', (_req, res) => {
      res.json({ extra: true })
    })
    const { app } = build({ routers: [extra] })
    expect((await request(app).get('/api/v1/extra')).status).toBe(401)
    const res = await keyed(request(app).get('/api/v1/extra'))
    expect(res.body).toEqual({ extra: true })
  })

  it('aplica el CORS configurado con la lista de orígenes de la config', async () => {
    const { app } = build({
      config: { ...testConfig, corsAllowedOrigins: ['https://app.example'] }
    })
    const res = await request(app).get('/health').set('origin', 'https://app.example')
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example')
  })
})

describe('composición · panel de administración', () => {
  it('/admin/login se sirve sin API key', async () => {
    const { app } = build()
    const res = await request(app).get('/admin/login')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
  })

  it('/admin y /admin/users exigen la sesión del panel (no la API key)', async () => {
    const { app } = build()
    for (const path of ['/admin', '/admin/users', '/admin/settings']) {
      const res = await request(app).get(path)
      expect([302, 303, 401]).toContain(res.status)
      expect(res.headers['location'] ?? '/admin/login').toContain('/admin/login')
    }
  })

  it('con ADMIN_ENABLED=false el panel no existe', async () => {
    const { app } = build({ config: { ...testConfig, adminEnabled: false } })
    const res = await request(app).get('/admin/login')
    expect(res.status).toBe(404)
  })

  it('el login del panel acepta la contraseña de los secretos', async () => {
    const { app } = build()
    const page = await request(app).get('/admin/login')
    const cookies = page.headers['set-cookie'] as unknown as string[] | undefined
    expect(cookies?.some((c) => c.startsWith('tranqui_admin_csrf='))).toBe(true)
  })
})

describe('composición · página de prueba de passkeys', () => {
  it('se monta en el runtime local', async () => {
    const { app } = build()
    const res = await request(app).get('/dev/passkeys')
    expect(res.status).toBe(200)
  })

  it('NO se monta en Lambda', async () => {
    const { app } = build({ config: lambdaConfig })
    const res = await request(app).get('/dev/passkeys')
    expect(res.status).toBe(404)
    expect((await request(app).get('/dev/passkeys.js')).status).toBe(404)
  })
})

describe('composición · cableado entre módulos', () => {
  const register = async (app: ReturnType<typeof build>['app']) => {
    const options = await request(app)
      .post('/api/v1/auth/register/options')
      .send({ displayName: 'Alice', walletAddress: wallet('alice').id })
    expect(options.status).toBe(200)
    const challengeId = (options.body as { challengeId: string }).challengeId
    const verified = await request(app)
      .post('/api/v1/auth/register/verify')
      .send({ challengeId, credential: { id: 'cred-1' } })
    expect(verified.status).toBe(201)
    return (verified.body as { session: { token: string } }).session.token
  }

  it('registro → /me → vinculación de wallet usan las mismas dependencias', async () => {
    const { app } = build()
    const token = await register(app)
    const bearer = { authorization: `Bearer ${token}` }

    const me = await request(app).get('/api/v1/me').set(bearer)
    expect(me.status).toBe(200)

    const link = await request(app).post('/api/v1/me/wallet-link').set(bearer)
    expect(link.status).toBe(202)
    const body = link.body as { authorizationUrl: string; dailyLimit: unknown }
    expect(body.authorizationUrl).toMatch(/^https:\/\//)
    expect(body.dailyLimit).toEqual({ value: '200', assetCode: 'USD' })

    const allowance = await request(app).get('/api/v1/me/allowance').set(bearer)
    expect(allowance.status).toBe(403)
    expect(errorOf(allowance).code).toBe('WALLET_NOT_LINKED')
  })

  it('el grant se pide con la URL pública de la API como finish uri', async () => {
    const { app, gateway } = build({ publicApiUrl: 'https://api.tranqui.example' })
    const spy = vi.spyOn(gateway, 'requestOutgoingPaymentGrant')
    const token = await register(app)
    await request(app)
      .post('/api/v1/me/wallet-link')
      .set('authorization', `Bearer ${token}`)
    expect(spy).toHaveBeenCalledOnce()
    const input = spy.mock.calls[0]?.[0]
    expect(input?.finishUri).toMatch(
      /^https:\/\/api\.tranqui\.example\/api\/v1\/auth\/callback\?linkId=wl_/
    )
    expect(input?.limits.debitAmount).toEqual({ value: '200', assetCode: 'USD' })
  })

  it('borrar la cuenta cancela el grant de la vinculación activa (hook del 023)', async () => {
    const { app, gateway, storage } = build()
    const cancel = vi.spyOn(gateway, 'cancelGrant')
    const token = await register(app)
    const bearer = { authorization: `Bearer ${token}` }
    const me = await request(app).get('/api/v1/me').set(bearer)
    const userId = (me.body as { id: string }).id
    await storage.walletLinks.create({
      id: 'wl_01TESTLINK',
      userId,
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

    const res = await request(app).delete('/api/v1/me').set(bearer)
    expect(res.status).toBeLessThan(300)
    expect(cancel).toHaveBeenCalledWith({
      continueUri: 'https://auth.interledger-test.dev/continue/c1',
      continueToken: 'continue-token'
    })
    expect((await request(app).get('/api/v1/me').set(bearer)).status).toBe(401)
  })

  it('los pagos (007) usan la sesión: sin vinculación activa → 403 WALLET_NOT_LINKED', async () => {
    const { app } = build()
    const token = await register(app)
    const res = await request(app)
      .post('/api/v1/payments')
      .set({ authorization: `Bearer ${token}` })
      .send({
        type: 'p2p',
        receiverWalletAddress: wallet('shop').id,
        amount: { value: '10.00', assetCode: 'USD' }
      })
    expect(res.status).toBe(403)
    expect(errorOf(res).code).toBe('WALLET_NOT_LINKED')
  })

  it('con la vinculación activa cotiza el pago con las mismas dependencias', async () => {
    const { app, storage } = build()
    const token = await register(app)
    const bearer = { authorization: `Bearer ${token}` }
    const me = await request(app).get('/api/v1/me').set(bearer)
    await storage.walletLinks.create({
      id: 'wl_01TESTLINK',
      userId: (me.body as { id: string }).id,
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
    const res = await request(app)
      .post('/api/v1/payments')
      .set(bearer)
      .send({
        type: 'p2p',
        receiverWalletAddress: wallet('shop').id,
        amount: { value: '10.00', assetCode: 'USD' }
      })
    expect(res.status).toBe(201)
    const body = res.body as { paymentId: string; quote: { totalDebit: unknown } }
    expect(body.paymentId).toMatch(/^pay_/)
    expect(body.quote.totalDebit).toEqual({ value: '10.00', assetCode: 'USD' })
  })
})
