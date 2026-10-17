import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda'
import serverless from 'serverless-http'
import { createApp } from './app.js'
import { loadConfig } from './config/env.js'
import { loadSecrets } from './config/secrets.js'
import { createLogger } from './shared/logger.js'

type ServerlessHandler = ReturnType<typeof serverless>

/** Comma-separated host allowlist from `CORS_ALLOWED_ORIGINS`; empty values dropped. */
const corsAllowedOrigins = (): string[] =>
  (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

// Built once per Lambda instance (cold start) and reused by later invocations.
let ready: Promise<ServerlessHandler> | undefined

async function init(): Promise<ServerlessHandler> {
  const config = loadConfig()
  const logger = createLogger(config)
  const secrets = await loadSecrets(config)
  return serverless(
    createApp({ config, secrets, logger, corsAllowedOrigins: corsAllowedOrigins() })
  )
}

/** AWS Lambda entry point (`lambda.handler`) behind the API Gateway HTTP API. */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> {
  ready ??= init().catch((error: unknown) => {
    // Let the next invocation retry instead of caching the failure.
    ready = undefined
    throw error
  })
  const app = await ready
  return app(event, context)
}
