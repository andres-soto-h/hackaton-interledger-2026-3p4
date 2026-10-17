import { z } from 'zod'

const nodeEnvs = ['development', 'test', 'production'] as const
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

export type NodeEnv = (typeof nodeEnvs)[number]
export type LogLevel = (typeof logLevels)[number]

interface BaseConfig {
  nodeEnv: NodeEnv
  logLevel: LogLevel
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

// Keys follow the order of the spec's variable table, so errors list them in that order.
const localSchema = z.object({
  NODE_ENV: z.enum(nodeEnvs).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: logLevel,
  API_KEY: z.string(),
  OPEN_PAYMENTS_KEYS_FILE: z.string().default('./keys/open-payments.json')
})

const lambdaSchema = z.object({
  NODE_ENV: z.enum(nodeEnvs).default('production'),
  LOG_LEVEL: logLevel,
  API_KEY_SECRET_ARN: z.string(),
  OPEN_PAYMENTS_SECRET_ARN: z.string()
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
      openPaymentsSecretArn: data.OPEN_PAYMENTS_SECRET_ARN
    }
  }

  const data = parse(localSchema, input)
  return {
    runtime: 'local',
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    port: data.PORT,
    apiKey: data.API_KEY,
    openPaymentsKeysFile: data.OPEN_PAYMENTS_KEYS_FILE
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
