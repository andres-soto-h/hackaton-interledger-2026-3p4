import { createHash } from 'node:crypto'
import type { RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'
import type { IdempotencyStore } from '../idempotency/store.js'

const TTL_SECONDS = 86_400
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

const serializeBody = (body: unknown): string => {
  if (body === undefined) return ''
  return typeof body === 'string' ? body : JSON.stringify(body)
}

const isCacheable = (status: number): boolean =>
  (status >= 200 && status < 300) || (status >= 400 && status < 500)

/**
 * Idempotency for `POST`-like routes. With an `Idempotency-Key`, repeats of the
 * same body replay the stored response; a different body or a request still in
 * flight answers `409 IDEMPOTENCY_CONFLICT`. Only 2xx/4xx are stored.
 */
export const idempotency = (store: IdempotencyStore): RequestHandler => {
  return async (req, res, next) => {
    const rawKey = req.headers['idempotency-key']
    if (rawKey === undefined) {
      next()
      return
    }

    const key = Array.isArray(rawKey) ? undefined : rawKey
    if (key === undefined || !KEY_RE.test(key)) {
      next(
        new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'idempotency-key', message: 'Invalid Idempotency-Key' }
        ])
      )
      return
    }

    const apiKey = String(req.headers['x-api-key'] ?? '')
    const recordKey = `idem_${hash(apiKey + req.path + key)}`
    const bodyHash = hash(serializeBody(req.body))

    const result = await store.begin(recordKey, bodyHash, TTL_SECONDS)

    if (result.kind === 'in_progress' || result.kind === 'mismatch') {
      next(new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency conflict'))
      return
    }

    if (result.kind === 'replay') {
      res.status(result.status).json(result.body)
      return
    }

    // New request: run the handler, then persist 2xx/4xx or release on 5xx/errors.
    const originalJson = res.json.bind(res)
    res.json = ((body: unknown) => {
      if (isCacheable(res.statusCode)) {
        void store.complete(recordKey, res.statusCode, body)
      } else {
        void store.release(recordKey)
      }
      return originalJson(body)
    }) as typeof res.json

    next()
  }
}
