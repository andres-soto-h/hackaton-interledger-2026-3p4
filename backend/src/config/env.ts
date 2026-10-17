import { z } from 'zod'

const nodeEnvs = ['development', 'test', 'production'] as const
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

export type NodeEnv = (typeof nodeEnvs)[number]
export type LogLevel = (typeof logLevels)[number]

interface BaseConfig {
  nodeEnv: NodeEnv
  logLevel: LogLevel
  openPaymentsTimeoutMs: number
  walletProviderBaseUrl: string
  allowedWalletHosts: string[]
  maxPaymentAmounts: Record<string, string>
}

export interface LocalConfig extends BaseConfig {
  runtime: 'local'
  port: number
  apiKey: string
  openPaymentsKeysFile: string
}

export interface LambdaConfig extends BaseConfig {
  runtime: 'lambda'
  apiKeySecretArn: string
  openPaymentsSecretArn: string
}

export type Config = LocalConfig | LambdaConfig

export type Env = Record<string, string | undefined>

/** Thrown at startup when environment variables are missing or invalid. */
export class ConfigError extends Error {
  constructor(
    readonly missing: string[],
    readonly invalid: string[]
  ) {
    const parts: string[] = []
    if (missing.length > 0) {
      parts.push(`Missing required environment variables: ${missing.join(', ')}`)
    }
    if (invalid.length > 0) {
      parts.push(`Invalid environment variables: ${invalid.join(', ')}`)
    }
    super(parts.join('. '))
    this.name = 'ConfigError'
  }
}

const logLevel = z.enum(logLevels).default('info')

// Open Payments configuration (spec 003). Same variables in local and Lambda.
const openPaymentsTimeoutMs = z.coerce.number().int().positive().default(8000)

const walletProviderBaseUrl = z
  .url({ protocol: /^https$/ })
  .default('https://ilp.interledger-test.dev')
  .transform((url) => url.replace(/\/+$/, ''))

const allowedWalletHosts = z
  .string()
  .default('')
  .refine(
    (raw) =>
      raw
        .split(',')
        .map((host) => host.trim())
        .filter((host) => host.length > 0)
        .every((host) => !host.includes('://')),
    { message: 'Wallet hosts must not include a scheme' }
  )
  .transform((raw) =>
    raw
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0)
  )

const amountEntryPattern = /^([A-Z]{3}):(\d+(?:\.\d+)?)$/

const maxPaymentAmounts = z
  .string()
  .default('USD:1000')
  .refine(
    (raw) =>
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .every((entry) => {
          const match = amountEntryPattern.exec(entry)
          const amount = match?.[2]
          return match !== null && amount !== undefined && /[1-9]/.test(amount)
        }),
    { message: 'Amounts must be positive decimal values keyed by currency' }
  )
  .transform((raw): Record<string, string> => {
    const record: Record<string, string> = {}
    for (const entry of raw
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0)) {
      const match = amountEntryPattern.exec(entry)
      const code = match?.[1]
      const amount = match?.[2]
      if (code !== undefined && amount !== undefined) record[code] = amount
    }
    return record
  })

// Keys follow the order of the spec's variable table, so errors list them in that order.
const localSchema = z.object({
  NODE_ENV: z.enum(nodeEnvs).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: logLevel,
  API_KEY: z.string(),
  OPEN_PAYMENTS_KEYS_FILE: z.string().default('./keys/open-payments.json'),
  OPEN_PAYMENTS_TIMEOUT_MS: openPaymentsTimeoutMs,
  WALLET_PROVIDER_BASE_URL: walletProviderBaseUrl,
  ALLOWED_WALLET_HOSTS: allowedWalletHosts,
  MAX_PAYMENT_AMOUNTS: maxPaymentAmounts
})

const lambdaSchema = z.object({
  NODE_ENV: z.enum(nodeEnvs).default('production'),
  LOG_LEVEL: logLevel,
  API_KEY_SECRET_ARN: z.string(),
  OPEN_PAYMENTS_SECRET_ARN: z.string(),
  OPEN_PAYMENTS_TIMEOUT_MS: openPaymentsTimeoutMs,
  WALLET_PROVIDER_BASE_URL: walletProviderBaseUrl,
  ALLOWED_WALLET_HOSTS: allowedWalletHosts,
  MAX_PAYMENT_AMOUNTS: maxPaymentAmounts
})

/** AWS defines AWS_LAMBDA_FUNCTION_NAME in every Lambda execution environment. */
export const isLambda = (env: Env): boolean => Boolean(env.AWS_LAMBDA_FUNCTION_NAME)

/**
 * Reads and validates the configuration. Fails fast, naming every missing or
 * invalid variable (never their values).
 */
export function loadConfig(env: Env = process.env): Config {
  // Empty strings count as "not set".
  const input = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== '')
  )

  if (isLambda(env)) {
    const data = parse(lambdaSchema, input)
    return {
      runtime: 'lambda',
      nodeEnv: data.NODE_ENV,
      logLevel: data.LOG_LEVEL,
      apiKeySecretArn: data.API_KEY_SECRET_ARN,
      openPaymentsSecretArn: data.OPEN_PAYMENTS_SECRET_ARN,
      openPaymentsTimeoutMs: data.OPEN_PAYMENTS_TIMEOUT_MS,
      walletProviderBaseUrl: data.WALLET_PROVIDER_BASE_URL,
      allowedWalletHosts: data.ALLOWED_WALLET_HOSTS,
      maxPaymentAmounts: data.MAX_PAYMENT_AMOUNTS
    }
  }

  const data = parse(localSchema, input)
  return {
    runtime: 'local',
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    port: data.PORT,
    apiKey: data.API_KEY,
    openPaymentsKeysFile: data.OPEN_PAYMENTS_KEYS_FILE,
    openPaymentsTimeoutMs: data.OPEN_PAYMENTS_TIMEOUT_MS,
    walletProviderBaseUrl: data.WALLET_PROVIDER_BASE_URL,
    allowedWalletHosts: data.ALLOWED_WALLET_HOSTS,
    maxPaymentAmounts: data.MAX_PAYMENT_AMOUNTS
  }
}

function parse<T extends z.ZodObject>(schema: T, input: Env): z.infer<T> {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const missing: string[] = []
  const invalid: string[] = []
  for (const issue of result.error.issues) {
    const name = String(issue.path[0])
    const list = input[name] === undefined ? missing : invalid
    if (!list.includes(name)) list.push(name)
  }
  throw new ConfigError(missing, invalid)
}
