import { createApp } from '../../src/app.js'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import { createMeRouter } from '../../src/modules/users/me.routes.js'
import { createInMemoryUsersRepository } from '../../src/modules/users/in-memory-users.repository.js'
import type { User } from '../../src/modules/users/user.types.js'
import { computeCallbackHash } from '../../src/modules/wallet-links/callback-hash.js'
import { createInMemoryWalletLinksRepository } from '../../src/modules/wallet-links/in-memory-wallet-links.repository.js'
import { createStaticDailyLimitProvider } from '../../src/modules/wallet-links/daily-limit.provider.js'
import { createWalletLinksRouter } from '../../src/modules/wallet-links/wallet-links.routes.js'
import { createWalletLinksService } from '../../src/modules/wallet-links/wallet-links.service.js'
import { newUserId } from '../../src/shared/ids/ids.js'
import { createSessionService } from '../../src/shared/session/session.service.js'
import { createTokenCipher } from '../../src/shared/security/token-cipher.js'
import type { Logger } from '../../src/shared/logger.js'
import { createLogger } from '../../src/shared/logger.js'
import { testConfig, testSecrets } from './app.js'
import { SESSION_KEY, START, wallet } from './auth-context.js'

export const API_BASE_URL = 'https://api.example.test'
export const FRONTEND_RESULT_URL = 'https://app.example.test/wallet-link/result'
export const TOKEN_SECRET = 't'.repeat(64)
export const DAILY_LIMITS = { USD: '200.00', MXN: '4000.00' }

/**
 * Wallet-link stack with in-memory parts: fake gateway, repositories, static
 * daily limits and a controllable clock. Sessions are issued by the real
 * session service; no API key is sent (these routes use the user session).
 */
export function buildWalletLinksContext(
  options: {
    tokenTtlSeconds?: number
    logger?: Logger
    frontendResultUrl?: string | null
  } = {}
) {
  const clock = { value: START }
  const now = () => clock.value
  const users = createInMemoryUsersRepository()
  const links = createInMemoryWalletLinksRepository()
  const gateway = createFakeOpenPaymentsGateway({
    now: () => new Date(clock.value),
    tokenTtlSeconds: options.tokenTtlSeconds ?? 600
  })
  for (const name of ['alice', 'bob']) gateway.addWallet(wallet(name))
  gateway.addWallet(wallet('euro', 'EUR'))
  gateway.addWallet(wallet('shop', 'USD'))
  const sessions = createSessionService({
    signingKey: SESSION_KEY,
    ttlSeconds: 3600,
    now
  })
  const cipher = createTokenCipher(TOKEN_SECRET)
  const service = createWalletLinksService({
    links,
    gateway,
    cipher,
    dailyLimits: createStaticDailyLimitProvider(DAILY_LIMITS),
    apiBaseUrl: API_BASE_URL,
    now
  })

  const app = createApp({
    config: testConfig,
    secrets: testSecrets,
    logger: options.logger ?? createLogger(testConfig),
    routers: [
      createMeRouter({
        users,
        sessions,
        beforeDeleteAccount: (userId: string) => service.revokeForUser(userId)
      }),
      createWalletLinksRouter({
        service,
        users,
        sessions,
        ...(options.frontendResultUrl === null
          ? {}
          : { frontendResultUrl: options.frontendResultUrl ?? FRONTEND_RESULT_URL })
      })
    ]
  })

  const seedUser = async (
    overrides: Partial<User> = {},
    walletName = 'alice'
  ): Promise<{ user: User; token: string }> => {
    const w = wallet(walletName, walletName === 'euro' ? 'EUR' : 'USD')
    const user: User = {
      id: newUserId(clock.value),
      displayName: walletName,
      walletAddress: w.id,
      walletAssetCode: w.assetCode,
      status: 'ACTIVE',
      createdAt: new Date(clock.value).toISOString(),
      updatedAt: new Date(clock.value).toISOString(),
      ...overrides
    }
    await users.createUserWithCredential(user, {
      id: `cred-${user.id}`,
      userId: user.id,
      publicKey: 'pk',
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: true,
      createdAt: user.createdAt
    })
    return { user, token: sessions.issue(user.id).token }
  }

  /** Query string a wallet would send back after the user approves. */
  const approvalQuery = async (
    linkId: string,
    interactRef = 'ref-1'
  ): Promise<string> => {
    const link = await links.get(linkId)
    if (link?.authorization === undefined) throw new Error('link is not pending')
    const hash = computeCallbackHash({
      clientNonce: link.authorization.clientNonce,
      finishNonce: link.authorization.finishNonce,
      interactRef,
      authServerUrl: link.authorization.authServerUrl
    })
    return `linkId=${encodeURIComponent(linkId)}&interact_ref=${encodeURIComponent(interactRef)}&hash=${encodeURIComponent(hash)}`
  }

  return {
    app,
    users,
    links,
    gateway,
    sessions,
    cipher,
    service,
    seedUser,
    approvalQuery,
    advanceSeconds: (seconds: number) => {
      clock.value += seconds * 1000
    }
  }
}

export type WalletLinksContext = ReturnType<typeof buildWalletLinksContext>
