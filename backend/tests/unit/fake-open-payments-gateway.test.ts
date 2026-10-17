import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import type {
  OpenPaymentsGateway,
  WalletAddress
} from '../../src/integrations/open-payments/gateway.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import { caught } from '../helpers/errors.js'

const NOW = new Date('2026-10-16T10:00:00.000Z')
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

const wallet = (name: string, assetCode: string, assetScale = 2): WalletAddress => ({
  id: `https://ilp.interledger-test.dev/${name}`,
  publicName: name,
  assetCode,
  assetScale,
  authServer: 'https://auth.interledger-test.dev',
  resourceServer: 'https://ilp.interledger-test.dev'
})

const alice = wallet('alice', 'USD')
const shop = wallet('shop', 'USD')
const peso = wallet('peso', 'MXN')

const expectAppError = async (fn: () => unknown, status: number, code: string) => {
  const error = await caught(fn)
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({ status, code })
}

// Caso 14: the fake honours the gateway contract (same types and errors as the adapter).
describe('FakeOpenPaymentsGateway', () => {
  let fake: ReturnType<typeof createFakeOpenPaymentsGateway>
  let gateway: OpenPaymentsGateway

  beforeEach(() => {
    fake = createFakeOpenPaymentsGateway({ now: () => NOW })
    for (const w of [alice, shop, peso]) fake.addWallet(w)
    gateway = fake
  })

  const linkGrant = async () => {
    const pending = await gateway.requestOutgoingPaymentGrant({
      sender: alice,
      limits: {
        debitAmount: { value: '200.00', assetCode: 'USD' },
        interval: 'R/2026-10-16T05:00:00Z/P1D'
      },
      finishUri: 'https://api.example/api/v1/wallet-links/lnk_1/callback',
      clientNonce: 'client-nonce'
    })
    const grant = await gateway.continueGrant({
      continueUri: pending.continueUri,
      continueToken: pending.continueToken,
      interactRef: 'interact-ref'
    })
    return { pending, grant }
  }

  const quoteFor = async (incomingAmount = '25.00') => {
    const incoming = await gateway.createIncomingPayment({
      wallet: shop,
      amount: { value: incomingAmount, assetCode: 'USD' },
      expiresAt: later(30)
    })
    return gateway.createQuote({ sender: alice, receiver: incoming.id })
  }

  describe('wallets', () => {
    it('devuelve una wallet registrada', async () => {
      expect(await gateway.getWalletAddress(alice.id)).toEqual(alice)
    })

    it('responde WALLET_NOT_FOUND para una wallet desconocida', async () => {
      await expectAppError(
        () => gateway.getWalletAddress('https://ilp.interledger-test.dev/nobody'),
        422,
        'WALLET_NOT_FOUND'
      )
    })
  })

  describe('incoming payments', () => {
    it('crea y lee un incoming payment con monto', async () => {
      const created = await gateway.createIncomingPayment({
        wallet: shop,
        amount: { value: '25.00', assetCode: 'USD' },
        expiresAt: later(30),
        description: 'Pedido 42'
      })

      expect(created).toMatchObject({
        walletAddress: shop.id,
        incomingAmount: { value: '25.00', assetCode: 'USD' },
        receivedAmount: { value: '0.00', assetCode: 'USD' },
        completed: false,
        expiresAt: later(30),
        description: 'Pedido 42'
      })
      expect(created.id).toMatch(/^https:\/\/ilp\.interledger-test\.dev\//)
      expect(await gateway.getIncomingPayment(created.id)).toEqual(created)
    })

    it('crea un incoming payment sin monto', async () => {
      const created = await gateway.createIncomingPayment({
        wallet: shop,
        expiresAt: later(30)
      })
      expect(created.incomingAmount).toBeUndefined()
    })

    it('responde OPEN_PAYMENTS_ERROR para un incoming payment desconocido', async () => {
      await expectAppError(
        () =>
          gateway.getIncomingPayment(
            'https://ilp.interledger-test.dev/incoming-payments/x'
          ),
        502,
        'OPEN_PAYMENTS_ERROR'
      )
    })
  })

  describe('quotes', () => {
    it('cotiza lo que pide el incoming payment, en la misma moneda', async () => {
      const quote = await quoteFor('25.00')

      expect(quote).toMatchObject({
        walletAddress: alice.id,
        debitAmount: { value: '25.00', assetCode: 'USD' },
        receiveAmount: { value: '25.00', assetCode: 'USD' }
      })
      expect(quote.id).toEqual(expect.any(String))
      expect(quote.expiresAt.getTime()).toBeGreaterThan(NOW.getTime())
    })

    it('cotiza con debitAmount si el incoming payment no tiene monto', async () => {
      const incoming = await gateway.createIncomingPayment({
        wallet: shop,
        expiresAt: later(30)
      })
      const quote = await gateway.createQuote({
        sender: alice,
        receiver: incoming.id,
        debitAmount: { value: '12.34', assetCode: 'USD' }
      })

      expect(quote.debitAmount).toEqual({ value: '12.34', assetCode: 'USD' })
      expect(quote.receiveAmount).toEqual({ value: '12.34', assetCode: 'USD' })
      expect(quote.receiver).toBe(incoming.id)
    })

    it('responde QUOTE_FAILED entre monedas distintas (el fake no convierte)', async () => {
      const incoming = await gateway.createIncomingPayment({
        wallet: peso,
        amount: { value: '172.50', assetCode: 'MXN' },
        expiresAt: later(30)
      })
      await expectAppError(
        () => gateway.createQuote({ sender: alice, receiver: incoming.id }),
        422,
        'QUOTE_FAILED'
      )
    })
  })

  describe('grants y outgoing payments', () => {
    it('pide el grant interactivo y lo continúa', async () => {
      const { pending, grant } = await linkGrant()

      expect(pending).toMatchObject({
        interactRedirectUrl: expect.stringMatching(/^https:\/\//),
        continueUri: expect.stringMatching(/^https:\/\//),
        continueToken: expect.any(String),
        finishNonce: expect.any(String)
      })
      expect(grant).toMatchObject({
        accessToken: expect.any(String),
        manageUrl: expect.stringMatching(/^https:\/\//)
      })
    })

    it('rechaza continuar un grant con un token desconocido', async () => {
      await expectAppError(
        () =>
          gateway.continueGrant({
            continueUri: 'https://auth.interledger-test.dev/continue/x',
            continueToken: 'unknown',
            interactRef: 'ref'
          }),
        502,
        'OPEN_PAYMENTS_ERROR'
      )
    })

    it('crea y lee un outgoing payment con el token del grant', async () => {
      const { grant } = await linkGrant()
      const quote = await quoteFor('25.00')

      const outgoing = await gateway.createOutgoingPayment({
        sender: alice,
        quoteId: quote.id,
        accessToken: grant.accessToken,
        description: 'Pedido 42'
      })

      expect(outgoing).toMatchObject({
        walletAddress: alice.id,
        quoteId: quote.id,
        receiver: quote.receiver,
        debitAmount: quote.debitAmount,
        receiveAmount: quote.receiveAmount,
        sentAmount: { value: '0.00', assetCode: 'USD' },
        failed: false
      })
      expect(
        await gateway.getOutgoingPayment({
          url: outgoing.id,
          accessToken: grant.accessToken
        })
      ).toEqual(outgoing)
    })

    it('permite marcar un outgoing payment como completado o fallido', async () => {
      const { grant } = await linkGrant()
      const first = await gateway.createOutgoingPayment({
        sender: alice,
        quoteId: (await quoteFor('25.00')).id,
        accessToken: grant.accessToken
      })
      const second = await gateway.createOutgoingPayment({
        sender: alice,
        quoteId: (await quoteFor('5.00')).id,
        accessToken: grant.accessToken
      })

      fake.completeOutgoingPayment(first.id)
      fake.failOutgoingPayment(second.id)

      const read = (url: string) =>
        gateway.getOutgoingPayment({ url, accessToken: grant.accessToken })
      expect(await read(first.id)).toMatchObject({
        sentAmount: { value: '25.00', assetCode: 'USD' },
        failed: false
      })
      expect(await read(second.id)).toMatchObject({ failed: true })
    })

    it('rota el token: el nuevo funciona y el anterior ya no', async () => {
      const { grant } = await linkGrant()

      const rotated = await gateway.rotateToken({
        manageUrl: grant.manageUrl,
        accessToken: grant.accessToken
      })

      expect(rotated.accessToken).not.toBe(grant.accessToken)
      const quote = await quoteFor()
      await expectAppError(
        () =>
          gateway.createOutgoingPayment({
            sender: alice,
            quoteId: quote.id,
            accessToken: grant.accessToken
          }),
        502,
        'OPEN_PAYMENTS_ERROR'
      )
      await expect(
        gateway.createOutgoingPayment({
          sender: alice,
          quoteId: quote.id,
          accessToken: rotated.accessToken
        })
      ).resolves.toMatchObject({ quoteId: quote.id })
    })

    it('cancela el grant: sus tokens dejan de servir', async () => {
      const { pending, grant } = await linkGrant()

      await gateway.cancelGrant({
        continueUri: pending.continueUri,
        continueToken: pending.continueToken
      })

      const quote = await quoteFor()
      await expectAppError(
        () =>
          gateway.createOutgoingPayment({
            sender: alice,
            quoteId: quote.id,
            accessToken: grant.accessToken
          }),
        502,
        'OPEN_PAYMENTS_ERROR'
      )
    })

    it('rechaza un outgoing payment con un quote desconocido', async () => {
      const { grant } = await linkGrant()
      await expectAppError(
        () =>
          gateway.createOutgoingPayment({
            sender: alice,
            quoteId: 'https://ilp.interledger-test.dev/quotes/unknown',
            accessToken: grant.accessToken
          }),
        502,
        'OPEN_PAYMENTS_ERROR'
      )
    })
  })

  it('permite simular el fallo de la siguiente llamada a un método', async () => {
    const failure = new AppError(
      503,
      'OPEN_PAYMENTS_UNAVAILABLE',
      'Open Payments unavailable'
    )
    fake.failNext('getWalletAddress', failure)

    await expect(gateway.getWalletAddress(alice.id)).rejects.toBe(failure)
    await expect(gateway.getWalletAddress(alice.id)).resolves.toEqual(alice)
  })
})
