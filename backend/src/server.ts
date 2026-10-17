import { existsSync } from 'node:fs'
import { createApp } from './app.js'
import { loadConfig } from './config/env.js'
import { loadSecrets } from './config/secrets.js'
import { createLogger } from './shared/logger.js'

/** Local entry point: `pnpm dev`. Lambda uses `lambda.ts` instead. */
async function main(): Promise<void> {
  // Variables already set in the shell take precedence over `.env`.
  if (existsSync('.env')) process.loadEnvFile('.env')

  const config = loadConfig()
  if (config.runtime !== 'local') {
    throw new Error('server.ts runs locally only; Lambda uses lambda.handler')
  }

  const logger = createLogger(config)
  const secrets = await loadSecrets(config)
  const app = createApp({ config, secrets, logger })

  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'API listening')
  })
}

main().catch((error: unknown) => {
  // Config and secrets errors name what is wrong without exposing values.
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
