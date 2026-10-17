import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createOpenPaymentsGateway } from '../../src/integrations/open-payments/adapter.js'
import type { OpenPaymentsGateway } from '../../src/integrations/open-payments/gateway.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import { caught } from '../helpers/errors.js'
import {
  accessTokenBody,
  grantBody,
  incomingPaymentBody,
  KEY_ID,
  outgoingPaymentBody,
  pendingGrantBody,
  PLATFORM_WALLET_URL,
  quoteBody,
  RECEIVER,
  SENDER,
  walletAddressBody
} from '../fixtures/open-payments.js'

const server = setupServer()

interface Seen {
  method: string
  url: string
  headers: Headers
  body: unknown
}

let seen: Seen[] = []
const record = async (request: Request): Promise<void> => {
  const text = await request.clone().text()
  seen.push({
    method: request.method,
    url: request.url.replace(/\/$/, ''),
    headers: request.headers,
    body: text === '' ? undefined : (JSON.parse(text) as unknown)
  })
}
const calls = (method: string, url: string) =>
  seen.filter((s) => s.method === method && s.url === url)

// Caso 9–13: adapter against Open Payments HTTP fixtures (msw).
describe('Open Payments adapter', () => {
  let privateKey: KeyObject
  let gateway: OpenPaymentsGateway

  beforeAll(() => {
    privateKey = generateKeyPairSync('ed25519').privateKey
    server.listen({ onUnhandledRequest: 'error' })
  })
  afterAll(() => server.close())
  beforeEach(async () => {
    seen = []
    gateway = await createOpenPaymentsGateway({
      walletAddressUrl: PLATFORM_WALLET_URL,
      keyId: KEY_ID,
      privateKey,
      timeoutMs: 200,
      retryBaseDelayMs: 1
    })
  })
  afterEach(() => server.resetHandlers())

  describe('caso 9 · cada método contra fixtures', () => {
    it('getWalletAddress maps the wallet', async () => {
      server.use(
        http.get(SENDER.id, async ({ request }) => {
          await record(request)
          return HttpResponse.json(walletAddressBody(SENDER))
        })
      )
      expect(await gateway.getWalletAddress(SENDER.id)).toEqual(SENDER)
    })

    it('createIncomingPayment asks for a non-interactive grant at the receiver and creates the payment', async () => {
      server.use(
        http.post(`${RECEIVER.authServer}/`, async ({ request }) => {
          await record(request)
          return HttpResponse.json(
            grantBody(
              accessTokenBody('in-token', 'https://auth.shop.test/token/t1', [
                { type: 'incoming-payment', actions: ['create', 'read'] }
              ])
            )
          )
        }),
        http.post(`${RECEIVER.resourceServer}/incoming-payments`, async ({ request }) => {
          await record(request)
          return HttpResponse.json(incomingPaymentBody(), { status: 201 })
        })
      )

      const payment = await gateway.createIncomingPayment({
        wallet: RECEIVER,
        amount: { value: '100.00', assetCode: 'MXN' },
        expiresAt: new Date('2026-10-16T11:00:00.000Z'),
        description: 'Order 42'
      })

      expect(payment).toMatchObject({
        id: `${RECEIVER.resourceServer}/incoming-payments/ip1`,
        walletAddress: RECEIVER.id,
        incomingAmount: { value: '100.00', assetCode: 'MXN' },
        receivedAmount: { value: '0.00', assetCode: 'MXN' },
        completed: false,
        description: 'Order 42'
      })
      expect(payment.expiresAt).toEqual(new Date('2026-10-16T11:00:00.000Z'))

      const [grant] = calls('POST', `${RECEIVER.authServer}`)
      expect(grant?.body).toMatchObject({
        client: PLATFORM_WALLET_URL,
        access_token: {
          access: [{ type: 'incoming-payment', actions: ['create', 'read'] }]
        }
      })
      const [create] = calls('POST', `${RECEIVER.resourceServer}/incoming-payments`)
      expect(create?.headers.get('authorization')).toBe('GNAP in-token')
      expect(create?.body).toMatchObject({
        walletAddress: RECEIVER.id,
        incomingAmount: { value: '10000', assetCode: 'MXN', assetScale: 2 },
        expiresAt: '2026-10-16T11:00:00.000Z',
        metadata: { description: 'Order 42' }
      })
    })

    it('getIncomingPayment maps the received amount', async () => {
      const url = `${RECEIVER.resourceServer}/incoming-payments/ip1`
      server.use(
        http.get(url, async ({ request }) => {
          await record(request)
          return HttpResponse.json(incomingPaymentBody('10000'))
        })
      )
      const payment = await gateway.getIncomingPayment(url)
      expect(payment.id).toBe(url)
      expect(payment.receivedAmount).toEqual({ value: '100.00', assetCode: 'MXN' })
    })

    it('createQuote asks for a quote grant at the sender and posts a fixed debit amount', async () => {
      server.use(
        http.post(`${SENDER.authServer}/`, async ({ request }) => {
          await record(request)
          return HttpResponse.json(
            grantBody(
              accessTokenBody('quote-token', 'https://auth.sender.test/token/t2', [
                { type: 'quote', actions: ['create', 'read'] }
              ])
            )
          )
        }),
        http.post(`${SENDER.resourceServer}/quotes`, async ({ request }) => {
          await record(request)
          return HttpResponse.json(quoteBody(), { status: 201 })
        })
      )

      const quote = await gateway.createQuote({
        sender: SENDER,
        receiver: `${RECEIVER.resourceServer}/incoming-payments/ip1`,
        debitAmount: { value: '5.50', assetCode: 'USD' }
      })

      expect(quote).toMatchObject({
        id: `${SENDER.resourceServer}/quotes/q1`,
        walletAddress: SENDER.id,
        debitAmount: { value: '5.50', assetCode: 'USD' },
        receiveAmount: { value: '100.00', assetCode: 'MXN' }
      })
      expect(quote.expiresAt).toEqual(new Date('2026-10-16T10:05:00.000Z'))
      const [create] = calls('POST', `${SENDER.resourceServer}/quotes`)
      expect(create?.headers.get('authorization')).toBe('GNAP quote-token')
      expect(create?.body).toMatchObject({
        walletAddress: SENDER.id,
        receiver: `${RECEIVER.resourceServer}/incoming-payments/ip1`,
        method: 'ilp',
        debitAmount: { value: '550', assetCode: 'USD', assetScale: 2 }
      })
    })

    it('continueGrant exchanges interact_ref for the access token', async () => {
      server.use(
        http.post('https://auth.sender.test/continue/c1', async ({ request }) => {
          await record(request)
          return HttpResponse.json(
            grantBody(
              accessTokenBody('out-token', 'https://auth.sender.test/token/t3', [
                { type: 'outgoing-payment', actions: ['create', 'read'] }
              ]),
              'https://auth.sender.test/continue/c2'
            )
          )
        })
      )
      const result = await gateway.continueGrant({
        continueUri: 'https://auth.sender.test/continue/c1',
        continueToken: 'continue-token',
        interactRef: 'ref-123'
      })
      expect(result.accessToken).toBe('out-token')
      expect(result.manageUrl).toBe('https://auth.sender.test/token/t3')
      expect(result.expiresAt).toBeInstanceOf(Date)
      const [call] = calls('POST', 'https://auth.sender.test/continue/c1')
      expect(call?.headers.get('authorization')).toBe('GNAP continue-token')
      expect(call?.body).toEqual({ interact_ref: 'ref-123' })
    })

    it('createOutgoingPayment and getOutgoingPayment use the sender token', async () => {
      const url = `${SENDER.resourceServer}/outgoing-payments/op1`
      server.use(
        http.post(`${SENDER.resourceServer}/outgoing-payments`, async ({ request }) => {
          await record(request)
          return HttpResponse.json(outgoingPaymentBody(), { status: 201 })
        }),
        http.get(url, async ({ request }) => {
          await record(request)
          return HttpResponse.json(outgoingPaymentBody())
        })
      )

      const created = await gateway.createOutgoingPayment({
        sender: SENDER,
        quoteId: `${SENDER.resourceServer}/quotes/q1`,
        accessToken: 'out-token',
        description: 'Coffee'
      })
      expect(created).toMatchObject({
        id: url,
        quoteId: `${SENDER.resourceServer}/quotes/q1`,
        debitAmount: { value: '5.50', assetCode: 'USD' },
        receiveAmount: { value: '100.00', assetCode: 'MXN' },
        sentAmount: { value: '5.50', assetCode: 'USD' },
        failed: false,
        description: 'Coffee'
      })
      const [create] = calls('POST', `${SENDER.resourceServer}/outgoing-payments`)
      expect(create?.headers.get('authorization')).toBe('GNAP out-token')
      expect(create?.body).toMatchObject({
        walletAddress: SENDER.id,
        quoteId: `${SENDER.resourceServer}/quotes/q1`,
        metadata: { description: 'Coffee' }
      })

      const fetched = await gateway.getOutgoingPayment({ url, accessToken: 'out-token' })
      expect(fetched.id).toBe(url)
      expect(calls('GET', url)[0]?.headers.get('authorization')).toBe('GNAP out-token')
    })
  })

  describe('caso 10 · grant de pago saliente, rotateToken y cancelGrant', () => {
    it('sends limits, identifier, finish uri and nonce', async () => {
      server.use(
        http.post(`${SENDER.authServer}/`, async ({ request }) => {
          await record(request)
          return HttpResponse.json(pendingGrantBody(), { status: 200 })
        })
      )

      const pending = await gateway.requestOutgoingPaymentGrant({
        sender: SENDER,
        limits: {
          debitAmount: { value: '200.00', assetCode: 'USD' },
          interval: 'R/2026-10-16T05:00:00Z/P1D'
        },
        finishUri: 'https://api.example/api/v1/wallet-links/lnk_1/callback',
        clientNonce: 'client-nonce-1'
      })

      expect(pending).toEqual({
        interactRedirectUrl: 'https://auth.sender.test/interact/i1',
        continueUri: 'https://auth.sender.test/continue/c1',
        continueToken: 'continue-token',
        finishNonce: 'server-finish-nonce'
      })
      const [call] = calls('POST', SENDER.authServer)
      expect(call?.body).toMatchObject({
        client: PLATFORM_WALLET_URL,
        access_token: {
          access: [
            {
              type: 'outgoing-payment',
              actions: ['create', 'read'],
              identifier: SENDER.id,
              limits: {
                debitAmount: { value: '20000', assetCode: 'USD', assetScale: 2 },
                interval: 'R/2026-10-16T05:00:00Z/P1D'
              }
            }
          ]
        },
        interact: {
          start: ['redirect'],
          finish: {
            method: 'redirect',
            uri: 'https://api.example/api/v1/wallet-links/lnk_1/callback',
            nonce: 'client-nonce-1'
          }
        }
      })
    })

    it('rotateToken posts to the manage url with the current token', async () => {
      server.use(
        http.post('https://auth.sender.test/token/t3', async ({ request }) => {
          await record(request)
          return HttpResponse.json({
            access_token: accessTokenBody(
              'new-token',
              'https://auth.sender.test/token/t4',
              [{ type: 'outgoing-payment', actions: ['create', 'read'] }]
            )
          })
        })
      )
      const result = await gateway.rotateToken({
        manageUrl: 'https://auth.sender.test/token/t3',
        accessToken: 'out-token'
      })
      expect(result.accessToken).toBe('new-token')
      expect(result.manageUrl).toBe('https://auth.sender.test/token/t4')
      const [call] = calls('POST', 'https://auth.sender.test/token/t3')
      expect(call?.headers.get('authorization')).toBe('GNAP out-token')
    })

    it('cancelGrant deletes the continue uri with the continue token', async () => {
      server.use(
        http.delete('https://auth.sender.test/continue/c1', async ({ request }) => {
          await record(request)
          return new HttpResponse(null, { status: 204 })
        })
      )
      await gateway.cancelGrant({
        continueUri: 'https://auth.sender.test/continue/c1',
        continueToken: 'continue-token'
      })
      const [call] = calls('DELETE', 'https://auth.sender.test/continue/c1')
      expect(call?.headers.get('authorization')).toBe('GNAP continue-token')
    })
  })

  it('caso 11 · timeout → OPEN_PAYMENTS_TIMEOUT', async () => {
    server.use(
      http.get(SENDER.id, async () => {
        await delay('infinite')
        return HttpResponse.json(walletAddressBody(SENDER))
      })
    )
    const error = await caught(() => gateway.getWalletAddress(SENDER.id))
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ status: 504, code: 'OPEN_PAYMENTS_TIMEOUT' })
  })

  it('caso 12 · una lectura que falla dos veces por red tiene éxito al tercer intento', async () => {
    let attempts = 0
    server.use(
      http.get(SENDER.id, () => {
        attempts += 1
        if (attempts <= 2) return HttpResponse.error()
        return HttpResponse.json(walletAddressBody(SENDER))
      })
    )
    expect(await gateway.getWalletAddress(SENDER.id)).toEqual(SENDER)
    expect(attempts).toBe(3)
  })

  it('caso 12 · una lectura que falla siempre se rinde tras 3 intentos', async () => {
    let attempts = 0
    server.use(
      http.get(SENDER.id, () => {
        attempts += 1
        return HttpResponse.error()
      })
    )
    const error = await caught(() => gateway.getWalletAddress(SENDER.id))
    expect(error).toMatchObject({ status: 503, code: 'OPEN_PAYMENTS_UNAVAILABLE' })
    expect(attempts).toBe(3)
  })

  it('caso 13 · una creación que falla por red no se reintenta', async () => {
    let attempts = 0
    server.use(
      http.post(`${RECEIVER.authServer}/`, () =>
        HttpResponse.json(
          grantBody(
            accessTokenBody('in-token', 'https://auth.shop.test/token/t1', [
              { type: 'incoming-payment', actions: ['create', 'read'] }
            ])
          )
        )
      ),
      http.post(`${RECEIVER.resourceServer}/incoming-payments`, () => {
        attempts += 1
        return HttpResponse.error()
      })
    )
    const error = await caught(() =>
      gateway.createIncomingPayment({
        wallet: RECEIVER,
        expiresAt: new Date('2026-10-16T11:00:00.000Z')
      })
    )
    expect(error).toMatchObject({ status: 503, code: 'OPEN_PAYMENTS_UNAVAILABLE' })
    expect(attempts).toBe(1)
  })

  it('un 404 al obtener la wallet → WALLET_NOT_FOUND', async () => {
    server.use(
      http.get(SENDER.id, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 })
      )
    )
    const error = await caught(() => gateway.getWalletAddress(SENDER.id))
    expect(error).toMatchObject({ status: 422, code: 'WALLET_NOT_FOUND' })
  })
})
