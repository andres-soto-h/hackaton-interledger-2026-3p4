import type { Express, Router } from 'express'
import type { Config } from '../config/env.js'
import type { Secrets } from '../config/secrets.js'
import { createApp } from '../app.js'
import type { OpenPaymentsGateway } from '../integrations/open-payments/gateway.js'
import { createAdminRouter } from '../modules/admin/admin.routes.js'
import { createAdminUsersRouter } from '../modules/admin/admin-users.routes.js'
import { createOpenPaymentsStatusChecker } from '../modules/admin/home-summary.js'
import { createAuthRouter } from '../modules/auth/auth.routes.js'
import { createDevPasskeyPageRouter } from '../modules/dev/dev-passkey-page.routes.js'
import { createPaymentRequestsRouter } from '../modules/payments/payment-requests.routes.js'
import { createPaymentRequestsService } from '../modules/payments/payment-requests.service.js'
import { createMeRouter } from '../modules/users/me.routes.js'
import { createSettingsDailyLimitProvider } from '../modules/wallet-links/daily-limit.provider.js'
import { createWalletLinksRouter } from '../modules/wallet-links/wallet-links.routes.js'
import { createWalletLinksService } from '../modules/wallet-links/wallet-links.service.js'
import type { Logger } from '../shared/logger.js'
import { createTokenCipher } from '../shared/security/token-cipher.js'
import { createSessionService } from '../shared/session/session.service.js'
import type { EditableSettings } from '../shared/settings/editable-settings.js'
import { createStoreSettingsProvider } from '../shared/settings/store-settings-provider.js'
import type { PasskeyVerifier } from '../shared/webauthn/passkey-verifier.js'
import type { Storage } from './storage.js'

/** Everything `createComposition` needs; adapters arrive already built (dependency injection). */
export interface CompositionDeps {
  config: Config
  secrets: Secrets
  logger: Logger
  gateway: OpenPaymentsGateway
  verifier: PasskeyVerifier
  storage: Storage
  /** Public base URL of the API, without trailing slash (Open Payments finish URI). */
  publicApiUrl: string
  /** Milliseconds since the epoch; tests inject a fake clock. */
  now?: () => number
  /**
   * Extension point: routers of specs that are not wired yet (e.g. payments,
   * spec 007). They are mounted after the built-in modules.
   */
  extraRouters?: Router[]
}

const SESSION_TTL_SECONDS = 3600

/** Editable settings as configured by the environment: the defaults before the admin panel changes them. */
export function editableDefaults(config: Config): EditableSettings {
  return {
    walletProviderBaseUrl: config.walletProviderBaseUrl,
    allowedWalletHosts: [...config.allowedWalletHosts],
    maxPaymentAmounts: { ...config.maxPaymentAmounts },
    dailySpendLimits: { ...config.dailySpendLimits },
    feePercentage: config.feePercentage,
    linkAuthTtlSeconds: 600,
    frontendResultUrl: config.frontendResultUrl,
    paymentsEnabled: true
  }
}

/**
 * Composition root: builds the services of every module on top of the given
 * adapters and mounts their routers in `createApp`. Order matters only
 * through `createApp` (request id → logger → headers → CORS → API key → body).
 */
export function createComposition({
  config,
  secrets,
  logger,
  gateway,
  verifier,
  storage,
  publicApiUrl,
  now = Date.now,
  extraRouters = []
}: CompositionDeps): Express {
  const sessions = createSessionService({
    signingKey: secrets.sessionSigningKey,
    ttlSeconds: SESSION_TTL_SECONDS,
    now
  })
  const settings = createStoreSettingsProvider({
    store: storage.settingsStore,
    defaults: editableDefaults(config),
    now
  })

  const walletLinks = createWalletLinksService({
    links: storage.walletLinks,
    gateway,
    cipher: createTokenCipher(secrets.tokenEncryptionKey),
    dailyLimits: createSettingsDailyLimitProvider(settings),
    apiBaseUrl: publicApiUrl,
    now,
    timezone: config.dailyLimitTimezone,
    logger
  })

  const routers: Router[] = [
    createAuthRouter({
      users: storage.users,
      verifier,
      sessions,
      gateway,
      settings,
      webauthn: {
        rpID: config.webauthn.rpId,
        rpName: config.webauthn.rpName,
        origins: config.webauthn.origins
      },
      now
    }),
    createMeRouter({
      users: storage.users,
      sessions,
      beforeDeleteAccount: (userId) => walletLinks.revokeForUser(userId)
    }),
    createWalletLinksRouter({
      service: walletLinks,
      users: storage.users,
      sessions,
      frontendResultUrl: config.frontendResultUrl
    }),
    createPaymentRequestsRouter({
      service: createPaymentRequestsService({
        gateway,
        repository: storage.payments,
        settings,
        now: () => new Date(now())
      }),
      idempotencyStore: storage.idempotencyStore
    })
  ]

  routers.push(
    createAdminRouter({
      enabled: config.adminEnabled,
      adminPassword: secrets.adminPassword,
      sessionSigningKey: secrets.sessionSigningKey,
      settings,
      settingsStore: storage.settingsStore,
      activityLog: storage.activityLog,
      openPaymentsStatus: createOpenPaymentsStatusChecker({
        gateway,
        walletAddressUrl: secrets.openPayments.walletAddressUrl
      }),
      now,
      logger
    }),
    createAdminUsersRouter({
      enabled: config.adminEnabled,
      sessionSigningKey: secrets.sessionSigningKey,
      users: storage.users,
      activityLog: storage.activityLog,
      gateway,
      settings,
      enrollmentUrl: `${publicApiUrl}/dev/passkeys`,
      now
    })
  )

  // Local-only helper while the frontend does not exist (spec 019, case 16).
  if (config.runtime === 'local') routers.push(createDevPasskeyPageRouter())

  routers.push(...extraRouters)

  return createApp({
    config,
    secrets,
    logger,
    corsAllowedOrigins: config.corsAllowedOrigins,
    routers
  })
}
