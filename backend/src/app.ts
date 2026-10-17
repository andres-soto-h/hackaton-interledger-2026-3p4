import express, { type Express, type Router } from 'express'
import type { Config } from './config/env.js'
import { errorHandler } from './shared/errors/error-handler.js'
import { notFound } from './shared/errors/not-found.js'
import { createLogger, type Logger } from './shared/logger.js'

export interface AppDependencies {
  config: Config
  logger?: Logger
  /** Extra routers mounted after the built-in modules. */
  routers?: Router[]
}

/** Builds the Express app without listening: shared by local, Lambda and tests. */
export function createApp({
  config,
  logger = createLogger(config),
  routers = []
}: AppDependencies): Express {
  const app = express()
  app.disable('x-powered-by')

  app.use(express.json())

  for (const router of routers) app.use(router)

  app.use(notFound)
  app.use(errorHandler(logger))

  return app
}
