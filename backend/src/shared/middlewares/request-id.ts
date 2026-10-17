import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'
import { runWithRequestId } from '../request-context.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ULID_RE = /^[0-9A-Za-z]{26}$/

const isValidRequestId = (value: string): boolean =>
  UUID_RE.test(value) || ULID_RE.test(value)

/**
 * Reuses the incoming `x-request-id` when it is a valid UUID or ULID and
 * generates a new UUID otherwise. Exposes it as `req.id` (consumed by
 * pino-http) and echoes it back in the response. The rest of the chain runs
 * inside `runWithRequestId` so activity emitters can read it from the context.
 */
export const requestId = (): RequestHandler => (req, res, next) => {
  const received = req.headers['x-request-id']
  const id =
    typeof received === 'string' && isValidRequestId(received) ? received : randomUUID()
  req.id = id
  res.setHeader('x-request-id', id)
  runWithRequestId(id, () => {
    next()
  })
}
