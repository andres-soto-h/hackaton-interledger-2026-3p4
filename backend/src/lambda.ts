import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda'
import serverless from 'serverless-http'
import { bootstrap, resolvePublicApiUrl } from './composition/bootstrap.js'
import { loadConfig } from './config/env.js'
import { loadSecrets } from './config/secrets.js'
import { createLogger } from './shared/logger.js'

type ServerlessHandler = ReturnType<typeof serverless>

// Built once per Lambda instance (cold start) and reused by later invocations.
let ready: Promise<ServerlessHandler> | undefined

async function init(domainName: string): Promise<ServerlessHandler> {
  const config = loadConfig()
  const logger = createLogger(config)
  const secrets = await loadSecrets(config)
  const publicApiUrl = resolvePublicApiUrl(config, domainName)
  return serverless(await bootstrap({ config, secrets, logger, publicApiUrl }))
}

/** AWS Lambda entry point (`lambda.handler`) behind the API Gateway HTTP API. */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> {
  ready ??= init(event.requestContext.domainName).catch((error: unknown) => {
    // Let the next invocation retry instead of caching the failure.
    ready = undefined
    throw error
  })
  const app = await ready
  return app(event, context)
}
