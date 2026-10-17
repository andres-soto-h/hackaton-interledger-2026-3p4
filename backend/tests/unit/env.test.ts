import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/config/env.js'
import { openPaymentsTestConfig as openPaymentsDefaults } from '../helpers/app.js'

describe('loadConfig', () => {
  // Caso 10
  it('devuelve la configuración local tipada con valores por defecto', () => {
    const config = loadConfig({ NODE_ENV: 'development', API_KEY: 'local-key' })

    expect(config).toEqual({
      ...openPaymentsDefaults,
      runtime: 'local',
      nodeEnv: 'development',
      logLevel: 'info',
      port: 3000,
      apiKey: 'local-key',
      openPaymentsKeysFile: './keys/open-payments.json'
    })
  })

  it('respeta los valores definidos en local', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '4000',
      LOG_LEVEL: 'debug',
      API_KEY: 'local-key',
      OPEN_PAYMENTS_KEYS_FILE: '/tmp/keys.json'
    })

    expect(config).toEqual({
      ...openPaymentsDefaults,
      runtime: 'local',
      nodeEnv: 'test',
      logLevel: 'debug',
      port: 4000,
      apiKey: 'local-key',
      openPaymentsKeysFile: '/tmp/keys.json'
    })
  })

  it('devuelve la configuración de Lambda cuando AWS define AWS_LAMBDA_FUNCTION_NAME', () => {
    const config = loadConfig({
      AWS_LAMBDA_FUNCTION_NAME: 'api',
      API_KEY_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:api-key',
      OPEN_PAYMENTS_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:op'
    })

    expect(config).toEqual({
      ...openPaymentsDefaults,
      runtime: 'lambda',
      nodeEnv: 'production',
      logLevel: 'info',
      apiKeySecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:api-key',
      openPaymentsSecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:op'
    })
  })

  // Caso 11
  it('falla listando las variables obligatorias que faltan en local', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(ConfigError)
    expect(() => loadConfig({ NODE_ENV: 'development', API_KEY: '' })).toThrow(
      /Missing required environment variables: API_KEY/
    )
  })

  it('falla listando las variables obligatorias que faltan en Lambda', () => {
    try {
      loadConfig({ AWS_LAMBDA_FUNCTION_NAME: 'api' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const { missing } = error as ConfigError
      expect(missing).toEqual(['API_KEY_SECRET_ARN', 'OPEN_PAYMENTS_SECRET_ARN'])
      expect((error as Error).message).toContain('API_KEY_SECRET_ARN')
      expect((error as Error).message).toContain('OPEN_PAYMENTS_SECRET_ARN')
    }
  })

  it('falla indicando las variables con valores inválidos', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'staging', PORT: 'abc', LOG_LEVEL: 'loud', API_KEY: 'k' })
    ).toThrow(/Invalid environment variables: NODE_ENV, PORT, LOG_LEVEL/)
  })

  describe('configuración de Open Payments (spec 003)', () => {
    it('lee timeout, proveedor de wallets, hosts permitidos y límites por moneda', () => {
      const config = loadConfig({
        API_KEY: 'k',
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
      const config = loadConfig({
        AWS_LAMBDA_FUNCTION_NAME: 'api',
        API_KEY_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:api-key',
        OPEN_PAYMENTS_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:op',
        MAX_PAYMENT_AMOUNTS: 'EUR:800'
      })

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
        loadConfig({ API_KEY: 'k', [name]: value })
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        expect((error as ConfigError).invalid).toEqual([name])
        expect((error as Error).message).not.toContain(value)
      }
    })
  })
})
