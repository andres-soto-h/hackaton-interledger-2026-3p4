import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const ADMIN_AUD = 'tranqui-admin'
export const DEFAULT_SESSION_TTL_SECONDS = 28_800

const b64url = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

const hmac = (key: string, value: string): Buffer =>
  createHmac('sha256', key).update(value).digest()

const equal = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface AdminSessionOptions {
  sessionSigningKey: string
  sessionTtlSeconds?: number
  now?: () => number
}

export interface AdminSessionManager {
  /** Signs a fresh `tranqui-admin` JWT (HS256). */
  issue(): string
  /** Verifies signature, `aud` and `exp` in constant time; any error → false. */
  verify(token: string): boolean
  /** Session-bound CSRF token: HMAC-SHA256(signingKey, token) in hex. */
  csrf(token: string): string
  csrfMatches(received: string, expected: string): boolean
  /** Random pre-session token stored in the login CSRF cookie. */
  newPreSessionToken(): string
}

/** Self-contained admin session JWT + CSRF (no dependencies, `node:crypto`). */
export function createAdminSession(options: AdminSessionOptions): AdminSessionManager {
  const key = options.sessionSigningKey
  const ttlSeconds = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS
  const now = options.now ?? (() => Date.now())

  const nowSeconds = (): number => Math.floor(now() / 1000)

  return {
    issue(): string {
      const header = b64url({ alg: 'HS256', typ: 'JWT' })
      const payload = b64url({ aud: ADMIN_AUD, exp: nowSeconds() + ttlSeconds })
      const unsigned = `${header}.${payload}`
      return `${unsigned}.${hmac(key, unsigned).toString('base64url')}`
    },

    verify(token: string): boolean {
      const parts = token.split('.')
      if (parts.length !== 3) return false
      const unsigned = `${parts[0]}.${parts[1]}`
      if (!equal(hmac(key, unsigned).toString('base64url'), parts[2]!)) return false
      try {
        const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as {
          aud?: unknown
          exp?: unknown
        }
        if (payload.aud !== ADMIN_AUD) return false
        if (typeof payload.exp !== 'number') return false
        return payload.exp > nowSeconds()
      } catch {
        return false
      }
    },

    csrf(token: string): string {
      return createHmac('sha256', key).update(token).digest('hex')
    },

    csrfMatches(received: string, expected: string): boolean {
      return equal(received, expected)
    },

    newPreSessionToken(): string {
      return randomBytes(32).toString('hex')
    }
  }
}
