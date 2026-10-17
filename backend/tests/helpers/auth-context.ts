import { createApp } from '../../src/app.js'
import { createAuthRouter } from '../../src/modules/auth/auth.routes.js'
import { createInMemoryUsersRepository } from '../../src/modules/users/in-memory-users.repository.js'
import { createMeRouter } from '../../src/modules/users/me.routes.js'
import type { Credential, User } from '../../src/modules/users/user.types.js'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import type { WalletAddress } from '../../src/integrations/open-payments/gateway.js'
import { newUserId } from '../../src/shared/ids/ids.js'
import { createLogger } from '../../src/shared/logger.js'
import { createSessionService } from '../../src/shared/session/session.service.js'
import type { ActivityLog } from '../../src/shared/activity/activity-log.js'
import { createActivityEmitter } from '../../src/shared/activity/activity-emitter.js'
import { createFakePasskeyVerifier } from './fake-passkey-verifier.js'
import { testConfig, testSecrets, TEST_API_KEY } from './app.js'

export const SESSION_KEY = 's'.repeat(64)
export const RP_ID = 'localhost'
export const ORIGINS = ['http://localhost:8081']
export const START = Date.UTC(2026, 9, 17, 10, 0, 0)

export const wallet = (name: string, assetCode = 'USD'): WalletAddress => ({
  id: `https://ilp.interledger-test.dev/${name}`,
  publicName: name,
  assetCode,
  assetScale: 2,
  authServer: 'https://auth.interledger-test.dev',
  resourceServer: 'https://ilp.interledger-test.dev'
})

/**
 * The whole account stack with in-memory parts: repository, fake WebAuthn
 * verifier, fake Open Payments gateway and a controllable clock.
 */
export function buildAuthContext(
  options: {
    sessionTtlSeconds?: number
    activityLog?: ActivityLog
    passkeyBypass?: boolean
  } = {}
) {
  const clock = { value: START }
  const now = () => clock.value
  const users = createInMemoryUsersRepository()
  const verifier = createFakePasskeyVerifier()
  const gateway = createFakeOpenPaymentsGateway({ now: () => new Date(clock.value) })
  for (const name of ['alice', 'bob']) gateway.addWallet(wallet(name))
  const sessions = createSessionService({
    signingKey: SESSION_KEY,
    ttlSeconds: options.sessionTtlSeconds ?? 3600,
    now
  })
  const settings = {
    getSettings: () =>
      Promise.resolve({
        walletProviderBaseUrl: testConfig.walletProviderBaseUrl,
        allowedWalletHosts: [],
        maxPaymentAmounts: { USD: '1000' }
      })
  }

  const app = createApp({
    config: testConfig,
    secrets: testSecrets,
    logger: createLogger(testConfig),
    routers: [
      createAuthRouter({
        users,
        verifier,
        sessions,
        gateway,
        settings,
        webauthn: { rpID: RP_ID, rpName: 'Tranqui', origins: ORIGINS },
        passkeyBypass: options.passkeyBypass,
        now,
        activity: createActivityEmitter({ log: options.activityLog })
      }),
      createMeRouter({
        users,
        sessions,
        activity: createActivityEmitter({ log: options.activityLog })
      })
    ]
  })

  /** Creates an account directly in the repository and returns it with a session token. */
  const seedUser = async (
    overrides: { user?: Partial<User>; credential?: Partial<Credential> } = {}
  ) => {
    const user: User = {
      id: newUserId(clock.value),
      displayName: 'Alice',
      walletAddress: wallet('alice').id,
      walletAssetCode: 'USD',
      status: 'ACTIVE',
      createdAt: new Date(clock.value).toISOString(),
      updatedAt: new Date(clock.value).toISOString(),
      ...overrides.user
    }
    const credential: Credential = {
      id: 'cred-alice-1',
      userId: user.id,
      publicKey: 'public-key-alice-1',
      counter: 0,
      transports: ['internal'],
      deviceType: 'multiDevice',
      backedUp: true,
      createdAt: user.createdAt,
      ...overrides.credential
    }
    await users.createUserWithCredential(user, credential)
    return { user, credential, token: sessions.issue(user.id).token }
  }

  return {
    app,
    users,
    verifier,
    gateway,
    sessions,
    settings,
    seedUser,
    apiKey: TEST_API_KEY,
    clock: {
      advanceSeconds: (seconds: number) => {
        clock.value += seconds * 1000
      }
    }
  }
}

export type AuthContext = ReturnType<typeof buildAuthContext>
