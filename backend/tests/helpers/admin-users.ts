import { createHash } from 'node:crypto'
import type { Express } from 'express'
import { createAdminRouter } from '../../src/modules/admin/admin.routes.js'
import { createAdminUsersRouter } from '../../src/modules/admin/admin-users.routes.js'
import type {
  AdminPaymentsReader,
  AdminWalletLinks,
  RecentPayment,
  WalletLinkSummary
} from '../../src/modules/admin/admin-users.types.js'
import { createAuthRouter } from '../../src/modules/auth/auth.routes.js'
import { createInMemoryUsersRepository } from '../../src/modules/users/in-memory-users.repository.js'
import { createMeRouter } from '../../src/modules/users/me.routes.js'
import type { Credential, User } from '../../src/modules/users/user.types.js'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import { createInMemoryActivityLog } from '../../src/shared/activity/in-memory-activity-log.js'
import { newUserId } from '../../src/shared/ids/ids.js'
import { createSessionService } from '../../src/shared/session/session.service.js'
import { createInMemorySettingsStore } from '../../src/shared/settings/in-memory-settings-store.js'
import { createStoreSettingsProvider } from '../../src/shared/settings/store-settings-provider.js'
import { buildTestApp } from './app.js'
import {
  ADMIN_PASSWORD,
  attemptLogin,
  call,
  csrfOf,
  DEFAULT_SETTINGS,
  HOST,
  ORIGIN,
  SIGNING_KEY,
  type AdminHarness,
  type AdminSession
} from './admin.js'
import { wallet, SESSION_KEY } from './auth-context.js'
import { createFakePasskeyVerifier } from './fake-passkey-verifier.js'

export const ENROLL_URL = 'https://app.example/enroll'
export const START_MS = Date.UTC(2026, 9, 17, 12, 0, 0)

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

/** Fakes of the optional ports of the user detail page (specs 023 and 004). */
export function createFakeWalletLinks() {
  const summaries = new Map<string, WalletLinkSummary>()
  const revoked: string[] = []
  const port: AdminWalletLinks = {
    getSummary: (userId) => Promise.resolve(summaries.get(userId) ?? null),
    revoke: (userId) => {
      revoked.push(userId)
      summaries.delete(userId)
      return Promise.resolve()
    }
  }
  return { port, summaries, revoked }
}

export function createFakePayments() {
  const byWallet = new Map<string, RecentPayment[]>()
  const port: AdminPaymentsReader = {
    listRecent: (walletAddress, limit) =>
      Promise.resolve((byWallet.get(walletAddress) ?? []).slice(0, limit))
  }
  return { port, byWallet }
}

export interface AdminUsersHarnessOptions {
  withPorts?: boolean
  enabled?: boolean
}

/**
 * One app with the admin login (spec 020), the users section (spec 021) and
 * the user-facing auth and `/me` routes, all over the same in-memory stores.
 */
export function buildAdminUsersHarness(options: AdminUsersHarnessOptions = {}) {
  const clock = { ms: START_MS }
  const now = () => clock.ms
  const users = createInMemoryUsersRepository()
  const activityLog = createInMemoryActivityLog({ now })
  const settingsStore = createInMemorySettingsStore()
  const settings = createStoreSettingsProvider({
    store: settingsStore,
    defaults: DEFAULT_SETTINGS,
    now
  })
  const gateway = createFakeOpenPaymentsGateway({ now: () => new Date(clock.ms) })
  for (const name of ['alice', 'bob', 'carla', 'diana']) gateway.addWallet(wallet(name))
  gateway.addWallet(wallet('peso', 'MXN'))
  const sessions = createSessionService({
    signingKey: SESSION_KEY,
    ttlSeconds: 3600,
    now
  })
  const verifier = createFakePasskeyVerifier()
  const walletLinks = createFakeWalletLinks()
  const payments = createFakePayments()

  const routers = [
    createAdminRouter({
      adminPassword: ADMIN_PASSWORD,
      sessionSigningKey: SIGNING_KEY,
      settings,
      settingsStore,
      activityLog,
      now
    }),
    createAdminUsersRouter({
      enabled: options.enabled,
      sessionSigningKey: SIGNING_KEY,
      users,
      activityLog,
      gateway,
      settings,
      enrollmentUrl: ENROLL_URL,
      ...(options.withPorts === true
        ? { walletLinks: walletLinks.port, payments: payments.port }
        : {}),
      now
    }),
    createAuthRouter({
      users,
      verifier,
      sessions,
      gateway,
      settings,
      webauthn: {
        rpID: 'localhost',
        rpName: 'Tranqui',
        origins: ['http://localhost:8081']
      },
      now
    }),
    createMeRouter({ users, sessions })
  ]
  const app: Express = buildTestApp(routers)

  /** Creates an account straight in the repository (with one passkey by default). */
  const seedUser = async (
    overrides: Partial<User> = {},
    credential: Partial<Credential> | null = {}
  ) => {
    const id = overrides.id ?? newUserId(clock.ms + Math.floor(Math.random() * 1e6))
    const user: User = {
      id,
      displayName: 'Alice',
      walletAddress: wallet('alice').id,
      walletAssetCode: 'USD',
      status: 'ACTIVE',
      createdAt: new Date(clock.ms).toISOString(),
      updatedAt: new Date(clock.ms).toISOString(),
      ...overrides
    }
    if (credential === null) {
      await users.createUser(user)
    } else {
      await users.createUserWithCredential(user, {
        id: `cred-${id}`,
        userId: id,
        publicKey: 'public-key',
        counter: 0,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: user.createdAt,
        ...credential
      })
    }
    return { user, token: sessions.issue(id, 0).token }
  }

  return {
    app,
    clock,
    users,
    activityLog,
    gateway,
    sessions,
    verifier,
    walletLinks,
    payments,
    seedUser
  }
}
export type AdminUsersHarness = ReturnType<typeof buildAdminUsersHarness>

/** Logs in as the administrator on the harness app. */
export async function loginAdmin(h: AdminUsersHarness): Promise<AdminSession> {
  const login = await attemptLogin(h as unknown as AdminHarness, ADMIN_PASSWORD)
  if (login.status !== 302) throw new Error(`admin login failed with ${login.status}`)
  const page = await call(h.app, 'get', '/admin/users').set('cookie', login.cookie)
  return { cookie: login.cookie, csrf: csrfOf(page.text) }
}

export const getAs = (h: AdminUsersHarness, session: AdminSession, path: string) =>
  call(h.app, 'get', path).set('cookie', session.cookie)

export const postAs = (
  h: AdminUsersHarness,
  session: AdminSession,
  path: string,
  form: Record<string, string> = {},
  extra: { origin?: string; csrf?: string | null } = {}
) => {
  const body: Record<string, string> = { ...form }
  if (extra.csrf !== null) body._csrf = extra.csrf ?? session.csrf
  return call(h.app, 'post', path)
    .type('form')
    .set('cookie', session.cookie)
    .set('origin', extra.origin ?? ORIGIN)
    .send(body)
}

export const enrollTokenOf = (page: string): string =>
  /enroll\?token=([0-9a-f]{64})/.exec(page)?.[1] ?? ''

export { HOST }
