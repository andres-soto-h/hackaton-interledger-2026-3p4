import request from 'supertest'
import { expect } from 'vitest'
import { createApp } from '../../src/app.js'
import { createPaymentStatusRouter } from '../../src/modules/payments/payment-status.routes.js'
import { createPaymentStatusService } from '../../src/modules/payments/payment-status.service.js'
import type { Payment, PaymentRequest } from '../../src/modules/payments/payment.types.js'
import { createMerchantDirectoryFromEntries } from '../../src/modules/transactions/merchant-directory.js'
import { createTransactionsRouter } from '../../src/modules/transactions/transactions.routes.js'
import { createTransactionsService } from '../../src/modules/transactions/transactions.service.js'
import { createLogger } from '../../src/shared/logger.js'
import type { Amount } from '../../src/shared/money/types.js'
import { testConfig, testSecrets } from './app.js'
import { bodyOf } from './body.js'
import { buildPaymentsContext } from './payments-context.js'

export const usd = (value: string): Amount => ({ value, assetCode: 'USD' })
export const ALICE = 'https://ilp.interledger-test.dev/alice'
export const BOB = 'https://ilp.interledger-test.dev/bob'
export const SHOP = 'https://ilp.interledger-test.dev/shop'
export const GHOST = 'https://ilp.interledger-test.dev/ghost'

/** Merchant of the directory used in the tests: the wallet `bob` is the merchant EPM. */
export const EPM = { id: 'mer_epm', name: 'EPM', walletAddress: BOB }

interface QuoteBody {
  paymentId: string
}
interface OptionsBody {
  challengeId: string
}

/**
 * Payments stack plus the status and transactions modules of spec 008, over the
 * same in-memory repositories, fake gateway and clock as `buildPaymentsContext`.
 */
export function buildTransactionsContext(
  options: Parameters<typeof buildPaymentsContext>[0] & {
    refreshConcurrency?: number
  } = {}
) {
  const base = buildPaymentsContext(options)
  const now = () => base.clock.value

  const statusService = createPaymentStatusService({
    payments: base.payments,
    walletLinks: base.walletLinks,
    gateway: base.gateway,
    feeCollector: base.feeCollector,
    now
  })
  const transactions = createTransactionsService({
    payments: base.payments,
    gateway: base.gateway,
    statusService,
    merchants: createMerchantDirectoryFromEntries([EPM]),
    now,
    ...(options.refreshConcurrency !== undefined
      ? { refreshConcurrency: options.refreshConcurrency }
      : {})
  })

  const app = createApp({
    config: testConfig,
    secrets: testSecrets,
    logger: createLogger(testConfig),
    routers: [
      createPaymentStatusRouter({
        service: statusService,
        users: base.users,
        sessions: base.sessions
      }),
      createTransactionsRouter({
        service: transactions,
        users: base.users,
        sessions: base.sessions
      })
    ]
  })

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
  const get = (path: string, token?: string) => {
    const req = request(app).get(path)
    return token === undefined ? req : req.set(bearer(token))
  }

  /**
   * Quote → confirm options → confirm through the real payments router, so the
   * payment ends `PROCESSING` with a reservation and a real fake-gateway outgoing payment.
   */
  const startPayment = async (
    seeded: { token: string; credentialId: string },
    value = '25.00',
    receiver = BOB
  ): Promise<Payment> => {
    const post = (path: string) => request(base.app).post(path).set(bearer(seeded.token))
    const quoted = await post('/api/v1/payments').send({
      type: 'p2p',
      receiverWalletAddress: receiver,
      amount: usd(value),
      description: 'Almuerzo'
    })
    expect(quoted.status).toBe(201)
    const { paymentId } = bodyOf<QuoteBody>(quoted)
    const opts = bodyOf<OptionsBody>(
      await post(`/api/v1/payments/${paymentId}/confirm/options`)
    )
    const confirmed = await post(`/api/v1/payments/${paymentId}/confirm`).send({
      challengeId: opts.challengeId,
      credential: { id: seeded.credentialId }
    })
    expect(confirmed.status).toBe(202)
    const stored = await base.payments.getPayment(paymentId)
    if (stored === null) throw new Error('payment not stored')
    return stored
  }

  /** A complete stored payment (any status) to seed the repository directly. */
  const makePayment = (overrides: Partial<Payment> & { id: string }): Payment => ({
    userId: 'usr_seed',
    walletLinkId: 'lnk_seed',
    type: 'p2p',
    senderWalletAddress: ALICE,
    receiverWalletAddress: BOB,
    incomingPaymentUrl: 'https://ilp.interledger-test.dev/incoming-payments/seed',
    fixedAmountSide: 'receive',
    quote: {
      id: 'https://ilp.interledger-test.dev/quotes/seed',
      debitAmount: usd('10.00'),
      receiveAmount: usd('10.00'),
      expiresAt: new Date(base.clock.value + 300_000).toISOString()
    },
    feePercentage: '1.5',
    fee: usd('0.15'),
    totalDebit: usd('10.15'),
    feeStatus: 'COLLECTED',
    status: 'COMPLETED',
    sentAmount: usd('10.00'),
    createdAt: new Date(base.clock.value).toISOString(),
    updatedAt: new Date(base.clock.value).toISOString(),
    ...overrides
  })

  const makeRequest = (
    overrides: Partial<PaymentRequest> & { id: string }
  ): PaymentRequest => ({
    type: 'p2m',
    receiverWalletAddress: ALICE,
    incomingPaymentUrl: 'https://ilp.interledger-test.dev/incoming-payments/req',
    amount: usd('25.00'),
    description: 'Pedido 42',
    status: 'PENDING',
    expiresAt: new Date(base.clock.value + 1_800_000).toISOString(),
    createdAt: new Date(base.clock.value).toISOString(),
    updatedAt: new Date(base.clock.value).toISOString(),
    ...overrides
  })

  return {
    ...base,
    app,
    get,
    bearer,
    startPayment,
    makePayment,
    makeRequest
  }
}

export type TransactionsContext = ReturnType<typeof buildTransactionsContext>
