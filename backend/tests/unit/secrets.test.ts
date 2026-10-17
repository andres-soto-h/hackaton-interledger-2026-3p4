import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LambdaConfig, LocalConfig } from '../../src/config/env.js'
import { loadSecrets, SecretsError } from '../../src/config/secrets.js'

// Fake credentials: never real keys in the repo.
const openPayments = {
  walletAddressUrl: 'https://ilp.interledger-test.dev/platform',
  keyId: 'fake-key-id',
  privateKey: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----'
}

const lambdaConfig: LambdaConfig = {
  runtime: 'lambda',
  nodeEnv: 'production',
  logLevel: 'info',
  apiKeySecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:api-key',
  openPaymentsSecretArn: 'arn:aws:secretsmanager:us-east-1:1:secret:open-payments'
}

describe('loadSecrets', () => {
  let dir: string
  let localConfig: LocalConfig

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'secrets-test-'))
    localConfig = {
      runtime: 'local',
      nodeEnv: 'test',
      logLevel: 'silent',
      port: 3000,
      apiKey: 'local-api-key',
      openPaymentsKeysFile: join(dir, 'open-payments.json')
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

    expect(secrets).toEqual({ apiKey: 'local-api-key', openPayments })
    expect(fetchSecret).not.toHaveBeenCalled()
  })

  it('en local falla con un error claro si el archivo no existe', async () => {
    await expect(loadSecrets(localConfig)).rejects.toThrow(SecretsError)
    await expect(loadSecrets(localConfig)).rejects.toThrow(
      `Cannot read Open Payments keys file: ${localConfig.openPaymentsKeysFile}`
    )
  })

  // Caso 13
  it('en Lambda lee ambos secretos de Secrets Manager por ARN', async () => {
    const fetchSecret = vi.fn((arn: string) =>
      Promise.resolve(
        arn === lambdaConfig.apiKeySecretArn
          ? 'aws-api-key'
          : JSON.stringify(openPayments)
      )
    )

    const secrets = await loadSecrets(lambdaConfig, { fetchSecret })

    expect(secrets).toEqual({ apiKey: 'aws-api-key', openPayments })
    expect(fetchSecret).toHaveBeenCalledTimes(2)
    expect(fetchSecret).toHaveBeenCalledWith(lambdaConfig.apiKeySecretArn)
    expect(fetchSecret).toHaveBeenCalledWith(lambdaConfig.openPaymentsSecretArn)
  })

  it('en Lambda falla si la API key está vacía', async () => {
    const fetchSecret = (arn: string) =>
      Promise.resolve(
        arn === lambdaConfig.apiKeySecretArn ? '' : JSON.stringify(openPayments)
      )

    await expect(loadSecrets(lambdaConfig, { fetchSecret })).rejects.toThrow(
      'API key secret is empty'
    )
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
      const fetchSecret = (arn: string) =>
        Promise.resolve(arn === lambdaConfig.apiKeySecretArn ? 'aws-api-key' : value)

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
