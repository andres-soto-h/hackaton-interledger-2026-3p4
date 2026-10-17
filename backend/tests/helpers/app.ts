import type { Router } from 'express'
import { createApp } from '../../src/app.js'
import type { LocalConfig } from '../../src/config/env.js'
import type { Secrets } from '../../src/config/secrets.js'
import { createLogger } from '../../src/shared/logger.js'

/** Fake values: tests never touch real files, keys or AWS. */
export const TEST_API_KEY = 'test-api-key'

export const testConfig: LocalConfig = {
  runtime: 'local',
  nodeEnv: 'test',
  logLevel: 'silent',
  port: 0,
  apiKey: TEST_API_KEY,
  openPaymentsKeysFile: './keys/does-not-exist.json'
}

export const testSecrets: Secrets = {
  apiKey: TEST_API_KEY,
  openPayments: {
    walletAddressUrl: 'https://wallet.example/platform',
    keyId: 'test-key-id',
    privateKey: 'not-a-real-key'
  }
}

export const buildTestApp = (routers: Router[] = []) =>
  createApp({
    config: testConfig,
    secrets: testSecrets,
    logger: createLogger(testConfig),
    routers
  })
