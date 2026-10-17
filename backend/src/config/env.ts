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
  /** Exact-origin CORS allowlist; empty disables CORS. */
  corsAllowedOrigins: string[]
  /** Admin panel switch (spec 020). */
  adminEnabled: boolean
  webauthn: { rpId: string; rpName: string; origins: string[] }
  /**
   * When `true`, WebAuthn verification is skipped (register, login and payment
   * confirmation all succeed without a real passkey). Only for local testing of
   * flows that depend on a session; never enable in production.
   */
  passkeyBypass: boolean
  /** Where the browser lands after authorizing a wallet link (spec 023). */
  frontendResultUrl: string
  /** Daily allowance per currency (spec 023). */
  dailySpendLimits: Record<string, string>
  dailyLimitTimezone: string
  /** Fee percentage as a decimal string (spec 024). */
  feePercentage: string
  /** Public base URL of the API; derived from the request when absent (Lambda). */
  publicApiUrl?: string
  /** Name of the agent Lambda (spec 028); without it the agent endpoint answers 503. */
  agentFunctionName?: string
  storage: 'memory' | 'dynamo'
  paymentsTableName?: string
  /** DynamoDB endpoint override (DynamoDB Local). */
  dynamoEndpoint?: string
}

export interface LocalConfig extends BaseConfig {
  runtime: 'local'
  port: number
  apiKey: string
  openPaymentsKeysFile: string
  sessionSecret: string
  adminPassword: string
  tokenKey: string
}

export interface LambdaConfig extends BaseConfig {
  runtime: 'lambda'
  apiKeySecretArn: string
  openPaymentsSecretArn: string
  sessionSecretArn: string
  adminPasswordSecretArn: string
  tokenKeySecretArn: string
  paymentsTableName: string
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

const amountMap = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
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

const maxPaymentAmounts = amountMap('COP:500000,USD:1000')
const dailySpendLimits = amountMap('COP:500000')

const csv = (raw: string): string[] =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

const isOrigin = (value: string): boolean => {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value
  } catch {
    return false
  }
}

/** Comma-separated exact origins (`scheme://host[:port]`, no path). */
const originList = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .refine((raw) => csv(raw).every(isOrigin), {
      message: 'Origins must be scheme://host[:port] without a path'
    })
    .transform(csv)

const isTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const booleanFlag = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true')

/** Boolean flag that is OFF unless explicitly set to `true`. */
const optInBooleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const feePercentage = z
  .string()
  .default('0')
  .refine((raw) => /^\d{1,3}(\.\d{1,4})?$/.test(raw) && Number(raw) <= 100, {
    message: 'Fee percentage must be a decimal between 0 and 100'
  })

const httpsUrlOrEmpty = z.url({ protocol: /^https?$/ }).optional()

const dailyLimitTimezone = z
  .string()
  .default('America/Bogota')
  .refine(isTimezone, { message: 'Unknown IANA timezone' })

const sessionSecret = z.string().min(32)
const adminPassword = z.string().min(12)
const tokenKey = z.string().min(32)

const sharedAppSchema = {
  CORS_ALLOWED_ORIGINS: originList(''),
  ADMIN_ENABLED: booleanFlag,
  WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
  WEBAUTHN_RP_NAME: z.string().min(1).default('Tranqui'),
  WEBAUTHN_ORIGINS: originList('http://localhost:3000'),
  PASSKEY_BYPASS: optInBooleanFlag,
  FRONTEND_RESULT_URL: httpsUrlOrEmpty,
  DAILY_SPEND_LIMITS: dailySpendLimits,
  DAILY_LIMIT_TIMEZONE: dailyLimitTimezone,
  FEE_PERCENTAGE: feePercentage,
  PUBLIC_API_URL: httpsUrlOrEmpty,
  AGENT_FUNCTION_NAME: z.string().min(1).optional()
}

// Keys follow the order of the spec's variable table, so errors list them in that order.
const localSchema = z.object({
  NODE_ENV: z.enum(nodeEnvs).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: logLevel,
  API_KEY: z.string(),
  SESSION_SECRET: sessionSecret,
  ADMIN_PASSWORD: adminPassword,
  TOKEN_KEY: tokenKey,
  OPEN_PAYMENTS_KEYS_FILE: z.string().default('./keys/open-payments.json'),
  OPEN_PAYMENTS_TIMEOUT_MS: openPaymentsTimeoutMs,
  WALLET_PROVIDER_BASE_URL: walletProviderBaseUrl,
  ALLOWED_WALLET_HOSTS: allowedWalletHosts,
  MAX_PAYMENT_AMOUNTS: maxPaymentAmounts,
  STORAGE: z.enum(['memory', 'dynamo']).default('memory'),
  PAYMENTS_TABLE_NAME: z.string().min(1).optional(),
  DYNAMODB_ENDPOINT: z.url().optional(),
  ...sharedAppSchema
})

const lambdaSchema = z.object({
  NODE_ENV: z.enum(nodeEnvs).default('production'),
  LOG_LEVEL: logLevel,
  API_KEY_SECRET_ARN: z.string(),
  OPEN_PAYMENTS_SECRET_ARN: z.string(),
  SESSION_SECRET_ARN: z.string(),
  ADMIN_PASSWORD_SECRET_ARN: z.string(),
  TOKEN_KEY_SECRET_ARN: z.string(),
  PAYMENTS_TABLE_NAME: z.string().min(1),
  OPEN_PAYMENTS_TIMEOUT_MS: openPaymentsTimeoutMs,
  WALLET_PROVIDER_BASE_URL: walletProviderBaseUrl,
  ALLOWED_WALLET_HOSTS: allowedWalletHosts,
  MAX_PAYMENT_AMOUNTS: maxPaymentAmounts,
  ...sharedAppSchema
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
      ...sharedConfig(data),
      runtime: 'lambda',
      nodeEnv: data.NODE_ENV,
      logLevel: data.LOG_LEVEL,
      apiKeySecretArn: data.API_KEY_SECRET_ARN,
      openPaymentsSecretArn: data.OPEN_PAYMENTS_SECRET_ARN,
      sessionSecretArn: data.SESSION_SECRET_ARN,
      adminPasswordSecretArn: data.ADMIN_PASSWORD_SECRET_ARN,
      tokenKeySecretArn: data.TOKEN_KEY_SECRET_ARN,
      paymentsTableName: data.PAYMENTS_TABLE_NAME,
      storage: 'dynamo'
    }
  }

  const data = parse(localSchema, input)
  if (data.STORAGE === 'dynamo' && data.PAYMENTS_TABLE_NAME === undefined) {
    throw new ConfigError(['PAYMENTS_TABLE_NAME'], [])
  }
  return {
    ...sharedConfig(data),
    runtime: 'local',
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    port: data.PORT,
    apiKey: data.API_KEY,
    openPaymentsKeysFile: data.OPEN_PAYMENTS_KEYS_FILE,
    sessionSecret: data.SESSION_SECRET,
    adminPassword: data.ADMIN_PASSWORD,
    tokenKey: data.TOKEN_KEY,
    storage: data.STORAGE,
    ...(data.PAYMENTS_TABLE_NAME !== undefined
      ? { paymentsTableName: data.PAYMENTS_TABLE_NAME }
      : {}),
    ...(data.DYNAMODB_ENDPOINT !== undefined
      ? { dynamoEndpoint: data.DYNAMODB_ENDPOINT }
      : {})
  }
}

/** Settings that are identical in local and Lambda. */
function sharedConfig(
  data: z.infer<typeof localSchema> | z.infer<typeof lambdaSchema>
): Omit<
  BaseConfig,
  'nodeEnv' | 'logLevel' | 'storage' | 'paymentsTableName' | 'dynamoEndpoint'
> {
  return {
    openPaymentsTimeoutMs: data.OPEN_PAYMENTS_TIMEOUT_MS,
    walletProviderBaseUrl: data.WALLET_PROVIDER_BASE_URL,
    allowedWalletHosts: data.ALLOWED_WALLET_HOSTS,
    maxPaymentAmounts: data.MAX_PAYMENT_AMOUNTS,
    corsAllowedOrigins: data.CORS_ALLOWED_ORIGINS,
    adminEnabled: data.ADMIN_ENABLED,
    webauthn: {
      rpId: data.WEBAUTHN_RP_ID,
      rpName: data.WEBAUTHN_RP_NAME,
      origins: data.WEBAUTHN_ORIGINS
    },
    passkeyBypass: data.PASSKEY_BYPASS,
    frontendResultUrl: data.FRONTEND_RESULT_URL ?? '',
    dailySpendLimits: data.DAILY_SPEND_LIMITS,
    dailyLimitTimezone: data.DAILY_LIMIT_TIMEZONE,
    feePercentage: data.FEE_PERCENTAGE,
    ...(data.PUBLIC_API_URL !== undefined
      ? { publicApiUrl: data.PUBLIC_API_URL.replace(/\/+$/, '') }
      : {}),
    ...(data.AGENT_FUNCTION_NAME !== undefined
      ? { agentFunctionName: data.AGENT_FUNCTION_NAME }
      : {})
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
