import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import type { WalletAddress } from '../../src/integrations/open-payments/gateway.js'
import { createInMemoryPaymentsRepository } from '../../src/modules/payments/in-memory-payments.repository.js'
import { createPaymentRequestsRouter } from '../../src/modules/payments/payment-requests.routes.js'
import { createPaymentRequestsService } from '../../src/modules/payments/payment-requests.service.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import { createInMemoryIdempotencyStore } from '../../src/shared/idempotency/in-memory-store.js'
import { createEnvSettingsProvider } from '../../src/shared/settings/settings-provider.js'
import { buildTestApp, TEST_API_KEY, testConfig } from '../helpers/app.js'
import { errorOf } from '../helpers/errors.js'

const NOW = new Date('2026-10-16T21:00:00.000Z')

const shop: WalletAddress = {
  id: 'https://ilp.interledger-test.dev/comercio-cafe',
  publicName: 'Café',
  assetCode: 'USD',
  assetScale: 2,
  authServer: 'https://auth.interledger-test.dev',
  resourceServer: 'https://ilp.interledger-test.dev'
}

interface PaymentRequestBody {
  id: string
  type: string
  incomingPaymentUrl: string
  receiverWalletAddress: string
  amount?: { value: string; assetCode: string }
  receivedAmount: { value: string; assetCode: string }
  description?: string
  status: string
  expiresAt: string
  createdAt: string
}

const validBody = {
  type: 'p2m',
  receiverWalletAddress: shop.id,
  amount: { value: '10.50', assetCode: 'USD' },
  description: 'Café y pan',
  expiresInSeconds: 900
}

describe('POST /api/v1/payment-requests', () => {
  let gateway: ReturnType<typeof createFakeOpenPaymentsGateway>
  let repository: ReturnType<typeof createInMemoryPaymentsRepository>
  let app: ReturnType<typeof buildTestApp>

  const post = (body: unknown, idempotencyKey?: string) => {
    const req = request(app)
      .post('/api/v1/payment-requests')
      .set('x-api-key', TEST_API_KEY)
    return (
      idempotencyKey === undefined ? req : req.set('idempotency-key', idempotencyKey)
    ).send(body as object)
  }

  const savedRequests = async () =>
    (
      await repository.listByWallet({
        walletAddress: shop.id,
        direction: 'incoming',
        kind: 'payment-request',
        limit: 50
      })
    ).items

  beforeEach(() => {
    gateway = createFakeOpenPaymentsGateway({ now: () => NOW })
    gateway.addWallet(shop)
    repository = createInMemoryPaymentsRepository()
    const service = createPaymentRequestsService({
      gateway,
      repository,
      settings: createEnvSettingsProvider(testConfig),
      now: () => NOW
    })
    app = buildTestApp([
      createPaymentRequestsRouter({
        service,
        idempotencyStore: createInMemoryIdempotencyStore()
      })
    ])
  })

  // Caso 1
  it('crea la solicitud con monto: incoming payment, registro guardado y 201', async () => {
    const spy = vi.spyOn(gateway, 'createIncomingPayment')
    const res = await post(validBody)
    const body = res.body as PaymentRequestBody

    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      type: 'p2m',
      receiverWalletAddress: shop.id,
      amount: { value: '10.50', assetCode: 'USD' },
      receivedAmount: { value: '0.00', assetCode: 'USD' },
      description: 'Café y pan',
      status: 'PENDING',
      expiresAt: '2026-10-16T21:15:00.000Z',
      createdAt: '2026-10-16T21:00:00.000Z'
    })
    expect(body.id).toMatch(/^pr_/)
    expect(body.incomingPaymentUrl).toMatch(
      /^https:\/\/ilp\.interledger-test\.dev\/incoming-payments\//
    )

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      wallet: shop,
      amount: { value: '10.50', assetCode: 'USD' },
      expiresAt: new Date('2026-10-16T21:15:00.000Z'),
      description: 'Café y pan'
    })

    const stored = await repository.getPaymentRequest(body.id)
    expect(stored).toMatchObject({
      id: body.id,
      type: 'p2m',
      receiverWalletAddress: shop.id,
      incomingPaymentUrl: body.incomingPaymentUrl,
      amount: { value: '10.50', assetCode: 'USD' },
      status: 'PENDING',
      expiresAt: '2026-10-16T21:15:00.000Z',
      createdAt: '2026-10-16T21:00:00.000Z'
    })
  })

  it('usa 900 segundos de vigencia por defecto', async () => {
    const res = await post({ type: 'p2p', receiverWalletAddress: shop.id })
    expect(res.status).toBe(201)
    expect((res.body as PaymentRequestBody).expiresAt).toBe('2026-10-16T21:15:00.000Z')
  })

  it('respeta expiresInSeconds', async () => {
    const res = await post({ ...validBody, expiresInSeconds: 60 })
    expect((res.body as PaymentRequestBody).expiresAt).toBe('2026-10-16T21:01:00.000Z')
  })

  it('acepta una wallet como payment pointer ($host/path)', async () => {
    const res = await post({
      type: 'p2m',
      receiverWalletAddress: '$ilp.interledger-test.dev/comercio-cafe'
    })
    expect(res.status).toBe(201)
    expect((res.body as PaymentRequestBody).receiverWalletAddress).toBe(shop.id)
  })

  // Caso 2
  it('sin monto: el incoming payment no lleva monto', async () => {
    const spy = vi.spyOn(gateway, 'createIncomingPayment')
    const res = await post({ type: 'p2p', receiverWalletAddress: shop.id })
    const body = res.body as PaymentRequestBody

    expect(res.status).toBe(201)
    expect(body.amount).toBeUndefined()
    expect(body.receivedAmount).toEqual({ value: '0.00', assetCode: 'USD' })
    expect(spy.mock.calls[0]?.[0].amount).toBeUndefined()
    const stored = await repository.getPaymentRequest(body.id)
    expect(stored?.amount).toBeUndefined()
  })

  // Caso 3
  it('assetCode distinto al de la wallet → 422 ASSET_MISMATCH sin crear nada', async () => {
    const spy = vi.spyOn(gateway, 'createIncomingPayment')
    const res = await post({ ...validBody, amount: { value: '10.50', assetCode: 'MXN' } })
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('ASSET_MISMATCH')
    expect(spy).not.toHaveBeenCalled()
    expect(await savedRequests()).toHaveLength(0)
  })

  // Caso 4
  it('wallet inexistente → 422 WALLET_NOT_FOUND', async () => {
    const res = await post({
      ...validBody,
      receiverWalletAddress: 'https://ilp.interledger-test.dev/no-existe'
    })
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('WALLET_NOT_FOUND')
  })

  // Caso 5
  it.each([
    'https://evil.example/comercio',
    'http://ilp.interledger-test.dev/comercio-cafe',
    'https://127.0.0.1/comercio',
    'https://ilp.interledger-test.dev:8443/comercio-cafe'
  ])(
    'wallet no permitida %s → 422 WALLET_NOT_ALLOWED sin llamadas al gateway',
    async (wallet) => {
      const spy = vi.spyOn(gateway, 'getWalletAddress')
      const res = await post({ ...validBody, receiverWalletAddress: wallet })
      // `http://` is rejected by the body schema (400); the rest by the anti-SSRF guard (422).
      if (wallet.startsWith('http://')) {
        expect(res.status).toBe(400)
      } else {
        expect(res.status).toBe(422)
        expect(errorOf(res).code).toBe('WALLET_NOT_ALLOWED')
      }
      expect(spy).not.toHaveBeenCalled()
    }
  )

  // Caso 6
  it.each([
    ['expiresInSeconds menor al mínimo', { ...validBody, expiresInSeconds: 59 }],
    ['expiresInSeconds mayor al máximo', { ...validBody, expiresInSeconds: 86401 }],
    ['expiresInSeconds no entero', { ...validBody, expiresInSeconds: 90.5 }],
    ['campo desconocido', { ...validBody, extra: true }],
    ['type inválido', { ...validBody, type: 'p2x' }],
    ['sin receiverWalletAddress', { type: 'p2m' }],
    ['descripción de 141 caracteres', { ...validBody, description: 'a'.repeat(141) }],
    ['monto cero', { ...validBody, amount: { value: '0', assetCode: 'USD' } }]
  ])('400 VALIDATION_ERROR: %s', async (_name, body) => {
    const spy = vi.spyOn(gateway, 'createIncomingPayment')
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
    expect(errorOf(res).details?.length).toBeGreaterThan(0)
    expect(spy).not.toHaveBeenCalled()
  })

  // Caso 7
  it('si Open Payments falla al crear el incoming payment, devuelve el error mapeado y no guarda nada', async () => {
    gateway.failNext(
      'createIncomingPayment',
      new AppError(503, 'OPEN_PAYMENTS_UNAVAILABLE', 'Open Payments is unavailable')
    )
    const res = await post(validBody)
    expect(res.status).toBe(503)
    expect(errorOf(res).code).toBe('OPEN_PAYMENTS_UNAVAILABLE')
    expect(await savedRequests()).toHaveLength(0)
  })

  it('un error desconocido del gateway se traduce a 502 OPEN_PAYMENTS_ERROR sin exponer el detalle', async () => {
    gateway.failNext('createIncomingPayment', new Error('secret internal detail'))
    const res = await post(validBody)
    expect(res.status).toBe(502)
    expect(errorOf(res).code).toBe('OPEN_PAYMENTS_ERROR')
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail')
    expect(await savedRequests()).toHaveLength(0)
  })

  // Idempotencia (spec 005 aplicada a esta ruta)
  it('con la misma Idempotency-Key y body crea una sola solicitud', async () => {
    const spy = vi.spyOn(gateway, 'createIncomingPayment')
    const first = await post(validBody, 'req-key-0001')
    const second = await post(validBody, 'req-key-0001')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(spy).toHaveBeenCalledOnce()
    expect(await savedRequests()).toHaveLength(1)
  })

  it('con la misma Idempotency-Key y otro body responde 409 IDEMPOTENCY_CONFLICT', async () => {
    await post(validBody, 'req-key-0002')
    const res = await post({ ...validBody, description: 'otra cosa' }, 'req-key-0002')
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('IDEMPOTENCY_CONFLICT')
  })

  // Caso 8
  it('sin API key → 401 y no crea nada', async () => {
    const spy = vi.spyOn(gateway, 'createIncomingPayment')
    const res = await request(app).post('/api/v1/payment-requests').send(validBody)
    expect(res.status).toBe(401)
    expect(spy).not.toHaveBeenCalled()
  })
})
