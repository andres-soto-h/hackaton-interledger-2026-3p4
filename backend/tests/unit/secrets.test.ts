import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LambdaConfig, LocalConfig } from '../../src/config/env.js'
import { loadSecrets, SecretsError } from '../../src/config/secrets.js'
import {
  openPaymentsTestConfig,
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  TEST_TOKEN_KEY
} from '../helpers/app.js'

// Fake credentials: never real keys in the repo.
const openPayments = {
  walletAddressUrl: 'https://ilp.interledger-test.dev/platform',
  keyId: 'fake-key-id',
  privateKey: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----'
}

const lambdaConfig: LambdaConfig = {
  ...openPaymentsTestConfig,
  runtime: 'lambda',
  nodeEnv: 'production',
  logLevel: 'info',
  apiKeySecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:api-key',
  openPaymentsSecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:open-payments',
  sessionSecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:session',
  adminPasswordSecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:admin',
  tokenKeySecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:token',
  paymentsTableName: 'payments-table',
  storage: 'dynamo'
}

const awsValues: Record<string, string> = {
  [lambdaConfig.apiKeySecretArn]: 'aws-api-key',
  [lambdaConfig.openPaymentsSecretArn]: JSON.stringify(openPayments),
  [lambdaConfig.sessionSecretArn]: 'a'.repeat(64),
  [lambdaConfig.adminPasswordSecretArn]: 'aws-admin-password',
  [lambdaConfig.tokenKeySecretArn]: 'b'.repeat(64)
}
const fromAws =
  (overrides: Record<string, string> = {}) =>
  (arn: string) =>
    Promise.resolve({ ...awsValues, ...overrides }[arn] ?? '')

describe('loadSecrets', () => {
  let dir: string
  let localConfig: LocalConfig

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'secrets-test-'))
    localConfig = {
      ...openPaymentsTestConfig,
      runtime: 'local',
      nodeEnv: 'test',
      logLevel: 'silent',
      port: 3000,
      apiKey: 'local-api-key',
      openPaymentsKeysFile: join(dir, 'open-payments.json'),
      sessionSecret: TEST_SESSION_SECRET,
      adminPassword: TEST_ADMIN_PASSWORD,
      tokenKey: TEST_TOKEN_KEY
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // Caso 12
  it('en local lee API_KEY de la configuración y las llaves del archivo JSON', async () => {
    await writeFile(localConfig.openPaymentsKeysFile, JSON.stringify(openPayments))
    const fetchSecret = vi.fn()

    const secrets = await loadSecrets(localConfig, { fetchSecret })

    expect(secrets).toEqual({
      apiKey: 'local-api-key',
      openPayments,
      sessionSigningKey: TEST_SESSION_SECRET,
      adminPassword: TEST_ADMIN_PASSWORD,
      tokenEncryptionKey: TEST_TOKEN_KEY
    })
    expect(fetchSecret).not.toHaveBeenCalled()
  })

  it('en local falla con un error claro si el archivo no existe', async () => {
    await expect(loadSecrets(localConfig)).rejects.toThrow(SecretsError)
    await expect(loadSecrets(localConfig)).rejects.toThrow(
      `Cannot read Open Payments keys file: ${localConfig.openPaymentsKeysFile}`
    )
  })

  // Caso 13
  it('en Lambda lee los cinco secretos de Secrets Manager por ARN', async () => {
    const fetchSecret = vi.fn(fromAws())

    const secrets = await loadSecrets(lambdaConfig, { fetchSecret })

    expect(secrets).toEqual({
      apiKey: 'aws-api-key',
      openPayments,
      sessionSigningKey: 'a'.repeat(64),
      adminPassword: 'aws-admin-password',
      tokenEncryptionKey: 'b'.repeat(64)
    })
    expect(fetchSecret).toHaveBeenCalledTimes(5)
    for (const arn of Object.keys(awsValues))
      expect(fetchSecret).toHaveBeenCalledWith(arn)
  })

  it('en Lambda falla si la API key está vacía', async () => {
    await expect(
      loadSecrets(lambdaConfig, {
        fetchSecret: fromAws({ [lambdaConfig.apiKeySecretArn]: '' })
      })
    ).rejects.toThrow('API key secret is empty')
  })

  it.each([
    ['la llave de sesión', 'sessionSecretArn', 'Session signing key secret is empty'],
    [
      'la contraseña del panel',
      'adminPasswordSecretArn',
      'Admin password secret is empty'
    ],
    [
      'la llave de cifrado de tokens',
      'tokenKeySecretArn',
      'Token encryption key secret is empty'
    ]
  ] as const)('en Lambda falla si %s está vacía', async (_name, arnField, message) => {
    await expect(
      loadSecrets(lambdaConfig, {
        fetchSecret: fromAws({ [lambdaConfig[arnField]]: '' })
      })
    ).rejects.toThrow(message)
  })

  it('en Lambda falla si la llave de sesión o de cifrado son demasiado cortas', async () => {
    await expect(
      loadSecrets(lambdaConfig, {
        fetchSecret: fromAws({ [lambdaConfig.sessionSecretArn]: 'short' })
      })
    ).rejects.toThrow(/at least 32 characters/)
    await expect(
      loadSecrets(lambdaConfig, {
        fetchSecret: fromAws({ [lambdaConfig.tokenKeySecretArn]: 'short' })
      })
    ).rejects.toThrow(/at least 32 characters/)
  })

  // Caso 14
  it.each([
    ['JSON inválido', 'not-json', /not valid JSON/],
    [
      'faltan campos',
      JSON.stringify({ walletAddressUrl: openPayments.walletAddressUrl }),
      /keyId, privateKey/
    ],
    [
      'walletAddressUrl no es URL',
      JSON.stringify({ ...openPayments, walletAddressUrl: '$ilp.example/me' }),
      /walletAddressUrl/
    ],
    ['un arreglo', JSON.stringify([openPayments]), /Invalid Open Payments secret format/]
  ])(
    'falla con un error claro si el secreto de Open Payments tiene formato inválido (%s)',
    async (_name, value, message) => {
      const fetchSecret = fromAws({ [lambdaConfig.openPaymentsSecretArn]: value })

      const result = loadSecrets(lambdaConfig, { fetchSecret })

      await expect(result).rejects.toThrow(SecretsError)
      await expect(result).rejects.toThrow(message)
    }
  )

  it('no incluye la llave privada en el mensaje de error', async () => {
    await writeFile(
      localConfig.openPaymentsKeysFile,
      JSON.stringify({ ...openPayments, keyId: 42 })
    )

    const error = await loadSecrets(localConfig).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SecretsError)
    expect((error as Error).message).toContain('keyId')
    expect((error as Error).message).not.toContain('PRIVATE KEY')
  })
})
