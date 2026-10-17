import type { Express } from 'express'
import request from 'supertest'
import { createAdminRouter } from '../../src/modules/admin/admin.routes.js'
import { createInMemoryActivityLog } from '../../src/shared/activity/in-memory-activity-log.js'
import type { EditableSettings } from '../../src/shared/settings/editable-settings.js'
import { createInMemorySettingsStore } from '../../src/shared/settings/in-memory-settings-store.js'
import { createStoreSettingsProvider } from '../../src/shared/settings/store-settings-provider.js'
import { buildTestApp } from './app.js'

export const ADMIN_PASSWORD = 'correct-horse-battery-staple'
export const SIGNING_KEY = 'test-session-signing-key-0123456789abcdef'
export const HOST = 'admin.test'
export const ORIGIN = `https://${HOST}`

export const DEFAULT_SETTINGS: EditableSettings = {
  walletProviderBaseUrl: 'https://ilp.interledger-test.dev',
  allowedWalletHosts: [],
  maxPaymentAmounts: { USD: '1000' },
  dailySpendLimits: { USD: '200' },
  feePercentage: '0',
  linkAuthTtlSeconds: 600,
  frontendResultUrl: '',
  paymentsEnabled: true
}

export interface HarnessOptions {
  enabled?: boolean
  defaults?: Partial<EditableSettings>
}

export function buildAdminHarness(options: HarnessOptions = {}) {
  const clock = { ms: Date.UTC(2026, 9, 17, 12, 0, 0) }
  const now = () => clock.ms
  const settingsStore = createInMemorySettingsStore()
  const settings = createStoreSettingsProvider({
    store: settingsStore,
    defaults: { ...DEFAULT_SETTINGS, ...options.defaults },
    now
  })
  const activityLog = createInMemoryActivityLog({ now })
  const router = createAdminRouter({
    enabled: options.enabled,
    adminPassword: ADMIN_PASSWORD,
    sessionSigningKey: SIGNING_KEY,
    settings,
    settingsStore,
    activityLog,
    now
  })
  const app: Express = buildTestApp([router])
  return { app, clock, settingsStore, settings, activityLog }
}
export type AdminHarness = ReturnType<typeof buildAdminHarness>

type Method = 'get' | 'post'

/** A request as the browser would send it to the admin host. */
export const call = (app: Express, method: Method, path: string) =>
  request(app)[method](path).set('host', HOST)

/** Joins the `name=value` pairs of the Set-Cookie headers into a Cookie header. */
export function cookieHeader(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : []
  return list
    .map((c) => c.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='))
    .join('; ')
}

export const mergeCookies = (...headers: string[]): string => {
  const jar = new Map<string, string>()
  for (const header of headers) {
    for (const pair of header.split('; ').filter(Boolean)) {
      const [name = '', ...rest] = pair.split('=')
      jar.set(name, rest.join('='))
    }
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

export const csrfOf = (page: string): string =>
  /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? ''

export const versionOf = (page: string): string =>
  /name="version" value="(\d+)"/.exec(page)?.[1] ?? ''

export interface LoginAttemptResult {
  status: number
  text: string
  cookie: string
}

/** GET the login form, then POST the password with the form's CSRF token. */
export async function attemptLogin(
  h: AdminHarness,
  password: string,
  extra: { origin?: string; withCsrf?: boolean } = {}
): Promise<LoginAttemptResult & { setCookie: string[] }> {
  const form = await call(h.app, 'get', '/admin/login')
  const preCookie = cookieHeader(form)
  const body: Record<string, string> = { password }
  if (extra.withCsrf !== false) body._csrf = csrfOf(form.text)
  const res = await call(h.app, 'post', '/admin/login')
    .type('form')
    .set('cookie', preCookie)
    .set('origin', extra.origin ?? ORIGIN)
    .send(body)
  const raw = res.headers['set-cookie'] as string[] | string | undefined
  return {
    status: res.status,
    text: res.text,
    cookie: mergeCookies(preCookie, cookieHeader(res)),
    setCookie: Array.isArray(raw) ? raw : raw ? [raw] : []
  }
}

export interface AdminSession {
  cookie: string
  csrf: string
}

/** Logs in with the right password and reads the session-bound CSRF token. */
export async function loginAsAdmin(h: AdminHarness): Promise<AdminSession> {
  const login = await attemptLogin(h, ADMIN_PASSWORD)
  if (login.status !== 302) throw new Error(`login failed with ${login.status}`)
  const page = await call(h.app, 'get', '/admin/settings').set('cookie', login.cookie)
  return { cookie: login.cookie, csrf: csrfOf(page.text) }
}

export const validSettingsForm = (
  overrides: Record<string, string | undefined> = {}
): Record<string, string> => {
  const base: Record<string, string | undefined> = {
    walletProviderBaseUrl: DEFAULT_SETTINGS.walletProviderBaseUrl,
    allowedWalletHosts: '',
    maxPaymentAmounts: 'USD:1000',
    dailySpendLimits: 'USD:200',
    feePercentage: '0',
    linkAuthTtlSeconds: '600',
    frontendResultUrl: '',
    paymentsEnabled: 'on',
    ...overrides
  }
  return Object.fromEntries(
    Object.entries(base).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
}

export async function postSettings(
  h: AdminHarness,
  session: AdminSession,
  form: Record<string, string>,
  extra: { origin?: string } = {}
) {
  return call(h.app, 'post', '/admin/settings')
    .type('form')
    .set('cookie', session.cookie)
    .set('origin', extra.origin ?? ORIGIN)
    .send(form)
}
