import type { RequestHandler } from 'express'
import { pinoHttp } from 'pino-http'
import type { Logger } from '../logger.js'

const SECRET_QUERY_KEYS = ['interact_ref', 'hash'] as const

/** Removes the values of `interact_ref` and `hash` from a logged URL. */
const redactUrlQuery = (url: string): string =>
  url.replace(/([?&](?:interact_ref|hash)=)[^&]*/gi, '$1[REDACTED]')

/** Redacts the parsed query object so the callback secrets never reach the log. */
const redactQueryObject = (query: unknown): unknown => {
  if (typeof query !== 'object' || query === null) return query
  const redacted: Record<string, unknown> = { ...(query as Record<string, unknown>) }
  for (const key of SECRET_QUERY_KEYS) {
    if (key in redacted) redacted[key] = '[REDACTED]'
  }
  return redacted
}

const redactReqSerializer = (
  serialized: Record<string, unknown>
): Record<string, unknown> => {
  let url = serialized.url
  if (typeof url === 'string') {
    url = redactUrlQuery(url)
  }
  return { ...serialized, url, query: redactQueryObject(serialized.query) }
}

/**
 * pino-http request logger: method, url, status, duration and request id.
 * Header redaction lives in the logger (`src/shared/logger.ts`); here we only
 * scrub the URL and the parsed query of the callback secrets.
 */
export const httpLogger = (logger: Logger): RequestHandler =>
  pinoHttp({
    logger,
    serializers: { req: redactReqSerializer }
  })
