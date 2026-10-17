import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/config/env.js'
import {
  openPaymentsTestConfig as openPaymentsDefaults,
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  TEST_TOKEN_KEY
} from '../helpers/app.js'

const LOCAL_SECRETS = {
  SESSION_SECRET: TEST_SESSION_SECRET,
  ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
  TOKEN_KEY: TEST_TOKEN_KEY
}
const LAMBDA_ENV = {
  AWS_LAMBDA_FUNCTION_NAME: 'api',
  API_KEY_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:api-key',
  OPEN_PAYMENTS_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:op',
  SESSION_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:session',
  ADMIN_PASSWORD_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:admin',
  TOKEN_KEY_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:token',
  PAYMENTS_TABLE_NAME: 'payments-table'
}

const LOCAL = { API_KEY: 'local-key', ...LOCAL_SECRETS }

describe('loadConfig', () => {
  // Caso 10
  it('devuelve la configuración local tipada con valores por defecto', () => {
    const config = loadConfig({ NODE_ENV: 'development', ...LOCAL })

    expect(config).toEqual({
      ...openPaymentsDefaults,
      runtime: 'local',
      nodeEnv: 'development',
      logLevel: 'info',
      port: 3000,
      apiKey: 'local-key',
      openPaymentsKeysFile: './keys/open-payments.json',
      sessionSecret: TEST_SESSION_SECRET,
      adminPassword: TEST_ADMIN_PASSWORD,
      tokenKey: TEST_TOKEN_KEY
    })
  })

  it('respeta los valores definidos en local', () => {
    const config = loadConfig({
      ...LOCAL,
      NODE_ENV: 'test',
      PORT: '4000',
      LOG_LEVEL: 'debug',
      OPEN_PAYMENTS_KEYS_FILE: '/tmp/keys.json'
    })

    expect(config).toMatchObject({
      runtime: 'local',
      nodeEnv: 'test',
      logLevel: 'debug',
      port: 4000,
      apiKey: 'local-key',
      openPaymentsKeysFile: '/tmp/keys.json'
    })
  })

  it('devuelve la configuración de Lambda cuando AWS define AWS_LAMBDA_FUNCTION_NAME', () => {
    const config = loadConfig(LAMBDA_ENV)

    expect(config).toEqual({
      ...openPaymentsDefaults,
      storage: 'dynamo',
      runtime: 'lambda',
      nodeEnv: 'production',
      logLevel: 'info',
      apiKeySecretArn: LAMBDA_ENV.API_KEY_SECRET_ARN,
      openPaymentsSecretArn: LAMBDA_ENV.OPEN_PAYMENTS_SECRET_ARN,
      sessionSecretArn: LAMBDA_ENV.SESSION_SECRET_ARN,
      adminPasswordSecretArn: LAMBDA_ENV.ADMIN_PASSWORD_SECRET_ARN,
      tokenKeySecretArn: LAMBDA_ENV.TOKEN_KEY_SECRET_ARN,
      paymentsTableName: 'payments-table'
    })
  })

  // Caso 11
  it('falla listando las variables obligatorias que faltan en local', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(ConfigError)
    expect(() => loadConfig({ NODE_ENV: 'development', API_KEY: '' })).toThrow(
      /Missing required environment variables: API_KEY, SESSION_SECRET, ADMIN_PASSWORD, TOKEN_KEY/
    )
  })

  it('falla listando las variables obligatorias que faltan en Lambda', () => {
    try {
      loadConfig({ AWS_LAMBDA_FUNCTION_NAME: 'api' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const { missing } = error as ConfigError
      expect(missing).toEqual([
        'API_KEY_SECRET_ARN',
        'OPEN_PAYMENTS_SECRET_ARN',
        'SESSION_SECRET_ARN',
        'ADMIN_PASSWORD_SECRET_ARN',
        'TOKEN_KEY_SECRET_ARN',
        'PAYMENTS_TABLE_NAME'
      ])
      expect((error as Error).message).toContain('PAYMENTS_TABLE_NAME')
    }
  })

  it('falla indicando las variables con valores inválidos', () => {
    expect(() =>
      loadConfig({ ...LOCAL, NODE_ENV: 'staging', PORT: 'abc', LOG_LEVEL: 'loud' })
    ).toThrow(/Invalid environment variables: NODE_ENV, PORT, LOG_LEVEL/)
  })

  describe('configuración de Open Payments (spec 003)', () => {
    it('lee timeout, proveedor de wallets, hosts permitidos y límites por moneda', () => {
      const config = loadConfig({
        ...LOCAL,
        OPEN_PAYMENTS_TIMEOUT_MS: '5000',
        WALLET_PROVIDER_BASE_URL: 'https://wallet.example/',
        ALLOWED_WALLET_HOSTS: ' pay.example , other.example ',
        MAX_PAYMENT_AMOUNTS: 'USD:1000, MXN:20000.50'
      })

      expect(config).toMatchObject({
        openPaymentsTimeoutMs: 5000,
        walletProviderBaseUrl: 'https://wallet.example',
        allowedWalletHosts: ['pay.example', 'other.example'],
        maxPaymentAmounts: { USD: '1000', MXN: '20000.50' }
      })
    })

    it('aplica la misma configuración en Lambda', () => {
      const config = loadConfig({ ...LAMBDA_ENV, MAX_PAYMENT_AMOUNTS: 'EUR:800' })

      expect(config).toMatchObject({
        runtime: 'lambda',
        openPaymentsTimeoutMs: 8000,
        walletProviderBaseUrl: 'https://ilp.interledger-test.dev',
        allowedWalletHosts: [],
        maxPaymentAmounts: { EUR: '800' }
      })
    })

    it.each([
      ['OPEN_PAYMENTS_TIMEOUT_MS', '0'],
      ['OPEN_PAYMENTS_TIMEOUT_MS', 'abc'],
      ['WALLET_PROVIDER_BASE_URL', 'http://wallet.example'],
      ['WALLET_PROVIDER_BASE_URL', 'not a url'],
      ['MAX_PAYMENT_AMOUNTS', 'USD'],
      ['MAX_PAYMENT_AMOUNTS', 'USD:abc'],
      ['MAX_PAYMENT_AMOUNTS', 'USD:0'],
      ['MAX_PAYMENT_AMOUNTS', 'usd:100'],
      ['ALLOWED_WALLET_HOSTS', 'https://pay.example']
    ])('rechaza %s=%s como inválida', (name, value) => {
      try {
        loadConfig({ ...LOCAL, [name]: value })
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        expect((error as ConfigError).invalid).toEqual([name])
        expect((error as Error).message).not.toContain(value)
      }
    })
  })

  describe('configuración de la composición (specs 019, 020, 023, 024)', () => {
    it('lee CORS, passkeys, panel, monto diario, comisión y URLs', () => {
      const config = loadConfig({
        ...LOCAL,
        CORS_ALLOWED_ORIGINS: 'https://app.example, https://admin.example',
        WEBAUTHN_RP_ID: 'tranqui.example',
        WEBAUTHN_RP_NAME: 'Tranqui Pay',
        WEBAUTHN_ORIGINS: 'https://app.tranqui.example,https://tranqui.example',
        ADMIN_ENABLED: 'false',
        FRONTEND_RESULT_URL: 'https://app.tranqui.example/link-result',
        DAILY_SPEND_LIMITS: 'USD:150,MXN:3000',
        DAILY_LIMIT_TIMEZONE: 'America/Mexico_City',
        FEE_PERCENTAGE: '1.5',
        PUBLIC_API_URL: 'https://api.tranqui.example'
      })

      expect(config).toMatchObject({
        corsAllowedOrigins: ['https://app.example', 'https://admin.example'],
        webauthn: {
          rpId: 'tranqui.example',
          rpName: 'Tranqui Pay',
          origins: ['https://app.tranqui.example', 'https://tranqui.example']
        },
        adminEnabled: false,
        frontendResultUrl: 'https://app.tranqui.example/link-result',
        dailySpendLimits: { USD: '150', MXN: '3000' },
        dailyLimitTimezone: 'America/Mexico_City',
        feePercentage: '1.5',
        publicApiUrl: 'https://api.tranqui.example'
      })
    })

    it('el almacenamiento local es en memoria salvo STORAGE=dynamo', () => {
      expect(loadConfig(LOCAL)).toMatchObject({ storage: 'memory' })
      expect(() => loadConfig({ ...LOCAL, STORAGE: 'dynamo' })).toThrow(
        /Missing required environment variables: PAYMENTS_TABLE_NAME/
      )
      expect(
        loadConfig({
          ...LOCAL,
          STORAGE: 'dynamo',
          PAYMENTS_TABLE_NAME: 'local-table',
          DYNAMODB_ENDPOINT: 'http://localhost:8000'
        })
      ).toMatchObject({
        storage: 'dynamo',
        paymentsTableName: 'local-table',
        dynamoEndpoint: 'http://localhost:8000'
      })
    })

    it.each([
      ['STORAGE', 'sqlite'],
      ['SESSION_SECRET', 'short'],
      ['ADMIN_PASSWORD', 'short'],
      ['TOKEN_KEY', 'short'],
      ['ADMIN_ENABLED', 'maybe'],
      ['WEBAUTHN_ORIGINS', 'not-an-origin'],
      ['CORS_ALLOWED_ORIGINS', 'app.example'],
      ['DAILY_SPEND_LIMITS', 'USD'],
      ['DAILY_LIMIT_TIMEZONE', 'Mars/Olympus'],
      ['FEE_PERCENTAGE', '101'],
      ['FEE_PERCENTAGE', 'abc'],
      ['FRONTEND_RESULT_URL', 'not a url'],
      ['PUBLIC_API_URL', 'ftp://api.example']
    ])('rechaza %s=%s como inválida sin mostrar el valor', (name, value) => {
      try {
        loadConfig({ ...LOCAL, [name]: value })
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        expect((error as ConfigError).invalid).toEqual([name])
        expect((error as Error).message).not.toContain(value)
      }
    })
  })
})
