import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/config/env.js'

describe('loadConfig', () => {
  // Caso 10
  it('devuelve la configuración local tipada con valores por defecto', () => {
    const config = loadConfig({ NODE_ENV: 'development', API_KEY: 'local-key' })

    expect(config).toEqual({
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
})
