import { vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import type { WalletAddress } from '../../src/integrations/open-payments/gateway.js'
import { createInMemoryPaymentsRepository } from '../../src/modules/payments/in-memory-payments.repository.js'
import { createFeeCalculator } from '../../src/modules/fees/fee-calculator.js'
import { createFeeCollector } from '../../src/modules/fees/fee-collector.js'
import type { FeeCalculator, FeeCollector } from '../../src/modules/payments/fee.js'
import { createPaymentsRouter } from '../../src/modules/payments/payments.routes.js'
import { createPaymentsService } from '../../src/modules/payments/payments.service.js'
import { createInMemoryUsersRepository } from '../../src/modules/users/in-memory-users.repository.js'
import type { Payment } from '../../src/modules/payments/payment.types.js'
import type { User } from '../../src/modules/users/user.types.js'
import { computeCallbackHash } from '../../src/modules/wallet-links/callback-hash.js'
import { createStaticDailyLimitProvider } from '../../src/modules/wallet-links/daily-limit.provider.js'
import { createInMemoryWalletLinksRepository } from '../../src/modules/wallet-links/in-memory-wallet-links.repository.js'
import { createWalletLinksService } from '../../src/modules/wallet-links/wallet-links.service.js'
import { createInMemoryIdempotencyStore } from '../../src/shared/idempotency/in-memory-store.js'
import { newUserId } from '../../src/shared/ids/ids.js'
import type { ActivityLog } from '../../src/shared/activity/activity-log.js'
import { createActivityEmitter } from '../../src/shared/activity/activity-emitter.js'
import { createLogger } from '../../src/shared/logger.js'
import { createTokenCipher } from '../../src/shared/security/token-cipher.js'
import { createSessionService } from '../../src/shared/session/session.service.js'
import type {
  EditableSettings,
  EditableSettingsProvider
} from '../../src/shared/settings/editable-settings.js'
import { testConfig, testSecrets } from './app.js'
import { ORIGINS, RP_ID, SESSION_KEY, START, wallet } from './auth-context.js'
import { createFakePasskeyVerifier } from './fake-passkey-verifier.js'

const FAKE_FEE_PERCENTAGE_SETTING = '1.5'
const DEFAULT_SETTINGS: EditableSettings = {
  walletProviderBaseUrl: 'https://ilp.interledger-test.dev',
  allowedWalletHosts: [],
  maxPaymentAmounts: { USD: '1000' },
  dailySpendLimits: { USD: '200.00' },
  feePercentage: FAKE_FEE_PERCENTAGE_SETTING,
  linkAuthTtlSeconds: 600,
  frontendResultUrl: '',
  paymentsEnabled: true
}

export const API_BASE_URL = 'https://api.example.test'
export const TOKEN_SECRET = 't'.repeat(64)
export const DAILY_LIMITS = { USD: '200.00', MXN: '4000.00' }
/** Flat fee of the fake calculator: 0.38 USD (1.5 %), on top of the debit amount. */
export const FAKE_FEE = '0.38'
export const FAKE_FEE_PERCENTAGE = '1.5'

const addCents = (value: string, fee: string): string => {
  const total = Math.round(Number(value) * 100) + Math.round(Number(fee) * 100)
  return (total / 100).toFixed(2)
}

/** Fake of the spec 024 port: always charges `FAKE_FEE` over the debit amount. */
export const createFakeFeeCalculator = (): FeeCalculator => ({
  calculate: (debit) =>
    Promise.resolve({
      percentage: FAKE_FEE_PERCENTAGE,
      fee: { value: FAKE_FEE, assetCode: debit.assetCode },
      totalDebit: {
        value: addCents(debit.value, FAKE_FEE),
        assetCode: debit.assetCode
      }
    })
})

/**
 * Payments stack with in-memory parts: fake gateway (wallets alice, bob, shop
 * in USD and pesos in MXN), repositories, fake WebAuthn verifier, wallet-link
 * service, static daily limits and a controllable clock.
 */
export const PLATFORM_WALLET = wallet('platform')

export function buildPaymentsContext(
  options: {
    tokenTtlSeconds?: number
    settings?: Partial<EditableSettings>
    /** `real` wires the spec 024 calculator and collector over the settings (default `fake`). */
    fees?: 'fake' | 'real'
    /** Spec 022: business activity log the services emit to (default none). */
    activityLog?: ActivityLog
    /** Technical logger that receives the warnings of a failing activity log. */
    activityLogger?: { warn: (...args: unknown[]) => void }
  } = {}
) {
  const activity = createActivityEmitter({
    log: options.activityLog,
    logger: options.activityLogger
  })
  const clock = { value: START }
  const now = () => clock.value
  const users = createInMemoryUsersRepository()
  const links = createInMemoryWalletLinksRepository()
  const payments = createInMemoryPaymentsRepository()
  const verifier = createFakePasskeyVerifier()
  const gateway = createFakeOpenPaymentsGateway({
    now: () => new Date(clock.value),
    tokenTtlSeconds: options.tokenTtlSeconds ?? 3600
  })
  for (const name of ['alice', 'bob', 'shop', 'platform']) gateway.addWallet(wallet(name))
  gateway.addWallet(wallet('pesos', 'MXN'))
  const sessions = createSessionService({
    signingKey: SESSION_KEY,
    ttlSeconds: 24 * 3600,
    now
  })
  const walletLinks = createWalletLinksService({
    links,
    gateway,
    cipher: createTokenCipher(TOKEN_SECRET),
    dailyLimits: createStaticDailyLimitProvider(DAILY_LIMITS),
    apiBaseUrl: API_BASE_URL,
    now,
    activity
  })

  const editable: EditableSettings = { ...DEFAULT_SETTINGS, ...options.settings }
  const settings: EditableSettingsProvider = {
    getSettings: () =>
      Promise.resolve({
        walletProviderBaseUrl: editable.walletProviderBaseUrl,
        allowedWalletHosts: [...editable.allowedWalletHosts],
        maxPaymentAmounts: { ...editable.maxPaymentAmounts }
      }),
    getEditable: () => Promise.resolve({ version: 1, settings: editable }),
    invalidate: () => undefined
  }

  const useRealFees = options.fees === 'real'
  const feeCollector: FeeCollector = useRealFees
    ? createFeeCollector({
        gateway,
        payments,
        walletLinks,
        platformWalletUrl: PLATFORM_WALLET.id,
        now,
        activity
      })
    : {
        collect: vi.fn(() => Promise.resolve()),
        refresh: vi.fn((payment: Payment) => Promise.resolve(payment))
      }
  const service = createPaymentsService({
    gateway,
    payments,
    links,
    walletLinks,
    users,
    verifier,
    settings,
    fees: useRealFees
      ? createFeeCalculator({
          percentage: async () => (await settings.getEditable()).settings.feePercentage
        })
      : createFakeFeeCalculator(),
    feeCollector,
    webauthn: { rpID: RP_ID, origins: ORIGINS },
    now,
    activity
  })

  const app = createApp({
    config: testConfig,
    secrets: testSecrets,
    logger: createLogger(testConfig),
    routers: [
      createPaymentsRouter({
        service,
        users,
        sessions,
        idempotencyStore: createInMemoryIdempotencyStore(),
        settings
      })
    ]
  })

  /** Creates an account (with one passkey `cred-<userId>`) and a session token. */
  const seedUser = async (
    walletName = 'alice'
  ): Promise<{ user: User; token: string; credentialId: string }> => {
    const w: WalletAddress = wallet(walletName)
    const user: User = {
      id: newUserId(clock.value),
      displayName: walletName,
      walletAddress: w.id,
      walletAssetCode: w.assetCode,
      status: 'ACTIVE',
      createdAt: new Date(clock.value).toISOString(),
      updatedAt: new Date(clock.value).toISOString()
    }
    const credentialId = `cred-${user.id}`
    await users.createUserWithCredential(user, {
      id: credentialId,
      userId: user.id,
      publicKey: 'pk',
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: true,
      createdAt: user.createdAt
    })
    return { user, token: sessions.issue(user.id).token, credentialId }
  }

  /** Seeds a user and activates their wallet link through the real service. */
  const seedLinkedUser = async (walletName = 'alice') => {
    const seeded = await seedUser(walletName)
    const started = await walletLinks.start(seeded.user)
    const link = await links.get(started.linkId)
    if (link?.authorization === undefined) throw new Error('link is not pending')
    const interactRef = 'ref-1'
    await walletLinks.handleCallback({
      linkId: started.linkId,
      interactRef,
      hash: computeCallbackHash({
        clientNonce: link.authorization.clientNonce,
        finishNonce: link.authorization.finishNonce,
        interactRef,
        authServerUrl: link.authorization.authServerUrl
      })
    })
    return { ...seeded, linkId: started.linkId }
  }

  return {
    app,
    clock,
    users,
    links,
    payments,
    gateway,
    sessions,
    verifier,
    walletLinks,
    feeCollector,
    editable,
    activityLog: options.activityLog,
    seedUser,
    seedLinkedUser,
    advanceSeconds: (seconds: number) => {
      clock.value += seconds * 1000
    }
  }
}

export type PaymentsContext = ReturnType<typeof buildPaymentsContext>
