import express, { type Express, type Router } from 'express'
import type { Config } from './config/env.js'
import type { Secrets } from './config/secrets.js'
import { healthRouter } from './modules/health/health.routes.js'
import { errorHandler } from './shared/errors/error-handler.js'
import { notFound } from './shared/errors/not-found.js'
import { createLogger, type Logger } from './shared/logger.js'
import { apiKeyAuth } from './shared/middlewares/api-key-auth.js'

export interface AppDependencies {
  config: Config
  secrets: Secrets
  logger?: Logger
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
  routers = []
}: AppDependencies): Express {
  const app = express()
  app.disable('x-powered-by')

  // Before the body parser: unauthenticated requests are rejected unread.
  app.use(apiKeyAuth(secrets.apiKey))
  app.use(express.json())

  app.use(healthRouter)
  for (const router of routers) app.use(router)

  app.use(notFound)
  app.use(errorHandler(logger))

  return app
}
