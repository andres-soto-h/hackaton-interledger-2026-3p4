import { createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'

/** `GET` routes that do not require the API key. */
const PUBLIC_GET_PATHS = new Set(['/health', '/api/v1/auth/callback'])

/**
 * Exact `METHOD path` routes that use their own auth (WebAuthn challenges and
 * the account session via `userAuth`) instead of the API key.
 */
const PUBLIC_ROUTES = new Set([
  'POST /api/v1/auth/register/options',
  'POST /api/v1/auth/register/verify',
  'POST /api/v1/auth/login/options',
  'POST /api/v1/auth/login/verify',
  'GET /api/v1/me',
  'DELETE /api/v1/me',
  'GET /dev/passkeys',
  'GET /dev/passkeys.js',
  'GET /dev/passkeys.css',
  'POST /api/v1/me/wallet-link',
  'GET /api/v1/me/wallet-link',
  'DELETE /api/v1/me/wallet-link',
  'GET /api/v1/me/allowance'
])

/** The admin panel has its own session auth; the API key never applies to it. */
const isAdminPath = (path: string): boolean =>
  path === '/admin' || path.startsWith('/admin/')

/** Payments write routes use the user session, not the API key (spec 007). */
const PAYMENT_ID = 'pay_[0-9A-Z]{26}'
const PAYMENT_CONFIRM_PATH = new RegExp(
  `^/api/v1/payments/${PAYMENT_ID}/(confirm/options|confirm|cancel)$`
)

const isPublicPaymentRoute = (method: string, path: string): boolean => {
  if (method !== 'POST') return false
  if (path === '/api/v1/payments') return true
  return PAYMENT_CONFIRM_PATH.test(path)
}

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
    if (
      (req.method === 'GET' && PUBLIC_GET_PATHS.has(req.path)) ||
      PUBLIC_ROUTES.has(`${req.method} ${req.path}`) ||
      isPublicPaymentRoute(req.method, req.path)
    ) {
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
