import { createLogger, type Logger } from '../../src/shared/logger.js'

/** A real pino logger at `info` that keeps every line, to assert on what gets logged. */
export function captureLogs(): { logger: Logger; text: () => string } {
  const lines: string[] = []
  const logger = createLogger(
    { logLevel: 'info' },
    { write: (line: string) => void lines.push(line) }
  )
  return { logger, text: () => lines.join('') }
}
