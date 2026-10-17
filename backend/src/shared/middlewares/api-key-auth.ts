import { createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'

/** `GET` routes that do not require the API key. */
const PUBLIC_GET_PATHS = new Set(['/health', '/api/v1/auth/callback'])

/** The admin panel has its own session auth; the API key never applies to it. */
const isAdminPath = (path: string): boolean =>
  path === '/admin' || path.startsWith('/admin/')

// Hashing both values gives equal-length buffers, so the comparison takes the
// same time whatever the length of the received key.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest()

/**
 * Requires `x-api-key` to match the expected key, compared in constant time.
 * The 401 does not reveal whether the key was missing or wrong.
 */
export function apiKeyAuth(expectedApiKey: string): RequestHandler {
  const expected = digest(expectedApiKey)

  return (req, _res, next) => {
    if (isAdminPath(req.path)) {
      next()
      return
    }
    if (req.method === 'GET' && PUBLIC_GET_PATHS.has(req.path)) {
      next()
      return
    }

    const received = req.headers['x-api-key']
    if (
      typeof received === 'string' &&
      received.length > 0 &&
      timingSafeEqual(digest(received), expected)
    ) {
      next()
      return
    }

    next(new AppError(401, 'UNAUTHORIZED', 'Invalid or missing API key'))
  }
}
