import { pino, type DestinationStream, type Logger } from 'pino'
import type { Config } from '../config/env.js'

export type { Logger }

/** Never let credentials reach the logs. */
const redactPaths = [
  'req.headers["x-api-key"]',
  'headers["x-api-key"]',
  'apiKey',
  '*.apiKey',
  'privateKey',
  '*.privateKey'
]

/** Structured JSON logger (CloudWatch-friendly). */
export function createLogger(
  config: Pick<Config, 'logLevel'>,
  destination?: DestinationStream
): Logger {
  return pino(
    {
      level: config.logLevel,
      base: undefined,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: redactPaths, censor: '[REDACTED]' }
    },
    destination
  )
}
