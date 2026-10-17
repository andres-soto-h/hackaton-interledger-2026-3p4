import type { Router } from 'express'
import { createApp } from '../../src/app.js'
import type { LocalConfig } from '../../src/config/env.js'
import type { Secrets } from '../../src/config/secrets.js'
import { createLogger, type Logger } from '../../src/shared/logger.js'

/** Fake values: tests never touch real files, keys or AWS. */
export const TEST_API_KEY = 'test-api-key'
export const TEST_SESSION_SECRET = 's'.repeat(64)
export const TEST_ADMIN_PASSWORD = 'admin-password-for-tests'
export const TEST_TOKEN_KEY = 't'.repeat(64)

/** Shared configuration with the documented defaults (specs 003, 019, 020, 023, 024). */
export const openPaymentsTestConfig = {
  openPaymentsTimeoutMs: 8000,
  walletProviderBaseUrl: 'https://ilp.interledger-test.dev',
  allowedWalletHosts: [] as string[],
  maxPaymentAmounts: { USD: '1000' } as Record<string, string>,
  corsAllowedOrigins: [] as string[],
  adminEnabled: true,
  webauthn: {
    rpId: 'localhost',
    rpName: 'Tranqui',
    origins: ['http://localhost:3000']
  },
  passkeyBypass: false,
  frontendResultUrl: '',
  dailySpendLimits: { USD: '200' } as Record<string, string>,
  dailyLimitTimezone: 'America/Bogota',
  feePercentage: '0',
  storage: 'memory' as const
}

export const testConfig: LocalConfig = {
  ...openPaymentsTestConfig,
  runtime: 'local',
  nodeEnv: 'test',
  logLevel: 'silent',
  port: 0,
  apiKey: TEST_API_KEY,
  openPaymentsKeysFile: './keys/does-not-exist.json',
  sessionSecret: TEST_SESSION_SECRET,
  adminPassword: TEST_ADMIN_PASSWORD,
  tokenKey: TEST_TOKEN_KEY
}

export const testSecrets: Secrets = {
  apiKey: TEST_API_KEY,
  sessionSigningKey: TEST_SESSION_SECRET,
  adminPassword: TEST_ADMIN_PASSWORD,
  tokenEncryptionKey: TEST_TOKEN_KEY,
  openPayments: {
    walletAddressUrl: 'https://wallet.example/platform',
    keyId: 'test-key-id',
    privateKey: 'not-a-real-key'
  }
}

export interface TestAppOptions {
  logger?: Logger
  corsAllowedOrigins?: string[]
}

export const buildTestApp = (routers: Router[] = [], options: TestAppOptions = {}) =>
  createApp({
    config: testConfig,
    secrets: testSecrets,
    logger: options.logger ?? createLogger(testConfig),
    corsAllowedOrigins: options.corsAllowedOrigins,
    routers
  })
