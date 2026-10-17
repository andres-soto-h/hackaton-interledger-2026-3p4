import express, { type Express, type Router } from 'express'
import type { Config } from './config/env.js'
import type { Secrets } from './config/secrets.js'
import { healthRouter } from './modules/health/health.routes.js'
import { errorHandler } from './shared/errors/error-handler.js'
import { notFound } from './shared/errors/not-found.js'
import { createLogger, type Logger } from './shared/logger.js'
import { apiKeyAuth } from './shared/middlewares/api-key-auth.js'
import { corsMiddleware } from './shared/middlewares/cors.js'
import { httpLogger } from './shared/middlewares/http-logger.js'
import { jsonBody } from './shared/middlewares/json-body.js'
import { requestId } from './shared/middlewares/request-id.js'
import { securityHeaders } from './shared/middlewares/security-headers.js'

export interface AppDependencies {
  config: Config
  secrets: Secrets
  logger?: Logger
  /** Exact-origin CORS allowlist; an empty list disables CORS. */
  corsAllowedOrigins?: string[]
  /** Extra routers mounted after the built-in modules. */
  routers?: Router[]
}

/**
 * Builds the Express app without listening: shared by local, Lambda and tests.
 * Configuration and secrets arrive already loaded (dependency injection).
 */
export function createApp({
  config,
  secrets,
  logger = createLogger(config),
  corsAllowedOrigins = [],
  routers = []
}: AppDependencies): Express {
  const app = express()
  app.disable('x-powered-by')

  app.use(requestId())
  app.use(httpLogger(logger))
  app.use(securityHeaders())
  // Before the API key so the preflight does not receive a 401.
  app.use(corsMiddleware(corsAllowedOrigins))
  // Before the body parser: unauthenticated requests are rejected unread.
  app.use(apiKeyAuth(secrets.apiKey))
  app.use(jsonBody())

  app.use(healthRouter)
  for (const router of routers) app.use(router)

  app.use(notFound)
  app.use(errorHandler(logger))

  return app
}
