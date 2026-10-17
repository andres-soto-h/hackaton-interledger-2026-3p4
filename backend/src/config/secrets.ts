import { readFile } from 'node:fs/promises'
import {
  GetSecretValueCommand,
  SecretsManagerClient
} from '@aws-sdk/client-secrets-manager'
import { z } from 'zod'
import type { Config } from './env.js'

/** Open Payments client credentials (same format locally and in AWS). */
const openPaymentsSchema = z.object({
  walletAddressUrl: z.url({ protocol: /^https$/ }),
  keyId: z.string().min(1),
  privateKey: z.string().min(1)
})

export type OpenPaymentsCredentials = z.infer<typeof openPaymentsSchema>

export interface Secrets {
  apiKey: string
  openPayments: OpenPaymentsCredentials
}

/** Secrets are missing or malformed. Messages never include secret values. */
export class SecretsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsError'
  }
}

export interface SecretsDependencies {
  /** Returns the SecretString of a Secrets Manager secret. */
  fetchSecret?: (arn: string) => Promise<string>
}

let secretsManager: SecretsManagerClient | undefined

const fetchFromSecretsManager = async (arn: string): Promise<string> => {
  secretsManager ??= new SecretsManagerClient({})
  const { SecretString } = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: arn })
  )
  return SecretString ?? ''
}

/**
 * Loads the API key and the Open Payments credentials: from `.env` and the
 * local JSON file, or from Secrets Manager when running in Lambda.
 */
export async function loadSecrets(
  config: Config,
  { fetchSecret = fetchFromSecretsManager }: SecretsDependencies = {}
): Promise<Secrets> {
  if (config.runtime === 'local') {
    return {
      apiKey: config.apiKey,
      openPayments: parseOpenPayments(await readKeysFile(config.openPaymentsKeysFile))
    }
  }

  const [apiKey, openPayments] = await Promise.all([
    fetchSecret(config.apiKeySecretArn),
    fetchSecret(config.openPaymentsSecretArn)
  ])
  if (apiKey.length === 0) throw new SecretsError('API key secret is empty')

  return { apiKey, openPayments: parseOpenPayments(openPayments) }
}

async function readKeysFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new SecretsError(`Cannot read Open Payments keys file: ${path}`)
  }
}

function parseOpenPayments(raw: string): OpenPaymentsCredentials {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new SecretsError('Invalid Open Payments secret format: not valid JSON')
  }

  const result = openPaymentsSchema.safeParse(json)
  if (result.success) return result.data

  const fields = [
    ...new Set(result.error.issues.map((issue) => issue.path.join('.')).filter(Boolean))
  ]
  const detail =
    fields.length > 0
      ? `missing or invalid ${fields.join(', ')}`
      : 'expected { walletAddressUrl, keyId, privateKey }'
  throw new SecretsError(`Invalid Open Payments secret format: ${detail}`)
}
