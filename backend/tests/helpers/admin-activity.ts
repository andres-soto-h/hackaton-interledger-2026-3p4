import type { Express } from 'express'
import { createAdminRouter } from '../../src/modules/admin/admin.routes.js'
import { createAdminActivityRouter } from '../../src/modules/admin/admin-activity.routes.js'
import { createInMemoryPaymentsRepository } from '../../src/modules/payments/in-memory-payments.repository.js'
import type { Payment } from '../../src/modules/payments/payment.types.js'
import { createInMemoryActivityLog } from '../../src/shared/activity/in-memory-activity-log.js'
import { createInMemorySettingsStore } from '../../src/shared/settings/in-memory-settings-store.js'
import { createStoreSettingsProvider } from '../../src/shared/settings/store-settings-provider.js'
import { buildPayment } from '../contract/payments-repository.contract.js'
import { buildTestApp } from './app.js'
import {
  ADMIN_PASSWORD,
  attemptLogin,
  call,
  csrfOf,
  DEFAULT_SETTINGS,
  SIGNING_KEY,
  type AdminHarness,
  type AdminSession
} from './admin.js'

export const START_MS = Date.UTC(2026, 9, 17, 12, 0, 0)

/** One app with the admin login (spec 020) and the activity pages (spec 022). */
export function buildActivityHarness(options: { enabled?: boolean } = {}) {
  const clock = { ms: START_MS }
  const now = () => clock.ms
  const activityLog = createInMemoryActivityLog({ now })
  const payments = createInMemoryPaymentsRepository()
  const settingsStore = createInMemorySettingsStore()
  const settings = createStoreSettingsProvider({
    store: settingsStore,
    defaults: DEFAULT_SETTINGS,
    now
  })
  const app: Express = buildTestApp([
    createAdminRouter({
      adminPassword: ADMIN_PASSWORD,
      sessionSigningKey: SIGNING_KEY,
      settings,
      settingsStore,
      activityLog,
      now
    }),
    createAdminActivityRouter({
      enabled: options.enabled,
      sessionSigningKey: SIGNING_KEY,
      activityLog,
      payments,
      now
    })
  ])

  const seedPayment = async (overrides: Partial<Payment> = {}): Promise<Payment> => {
    const payment = buildPayment(overrides)
    await payments.createPayment(payment)
    return payment
  }

  return { app, clock, activityLog, payments, seedPayment }
}
export type ActivityHarness = ReturnType<typeof buildActivityHarness>

export async function loginAdmin(h: ActivityHarness): Promise<AdminSession> {
  const login = await attemptLogin(h as unknown as AdminHarness, ADMIN_PASSWORD)
  if (login.status !== 302) throw new Error(`admin login failed with ${login.status}`)
  const page = await call(h.app, 'get', '/admin/settings').set('cookie', login.cookie)
  return { cookie: login.cookie, csrf: csrfOf(page.text) }
}

export const getAs = (h: ActivityHarness, session: AdminSession, path: string) =>
  call(h.app, 'get', path).set('cookie', session.cookie)
