import { createHmac, timingSafeEqual } from 'node:crypto'
import { AppError } from '../errors/app-error.js'

const HEADER = { alg: 'HS256', typ: 'JWT' } as const
const ISSUER = 'tranqui-api'
const AUDIENCE = 'tranqui-app'

export interface SessionClaims {
  userId: string
  /** The user's session version; `sv` claim, defaulting to 0 when absent. */
  sessionVersion: number
  iat: number
  exp: number
}

export interface Session {
  token: string
  /** ISO 8601 in UTC. */
  expiresAt: string
}

export interface SessionService {
  /** Adds the `sv` claim only when `sessionVersion` is provided. */
  issue(userId: string, sessionVersion?: number): Session
  /** Throws `AppError(401, 'SESSION_INVALID')` on any invalid token. */
  verify(token: string): SessionClaims
  isRecent(claims: SessionClaims, maxAgeSeconds: number): boolean
}

const base64url = (input: string): string => Buffer.from(input).toString('base64url')

const sign = (signingInput: string, signingKey: string): string =>
  createHmac('sha256', signingKey).update(signingInput).digest('base64url')

const invalid = (): AppError =>
  new AppError(401, 'SESSION_INVALID', 'Invalid or expired session')

const isHs256Header = (header: unknown): boolean =>
  typeof header === 'object' &&
  header !== null &&
  (header as Record<string, unknown>).alg === 'HS256' &&
  (header as Record<string, unknown>).typ === 'JWT'

const decodeJson = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
  } catch {
    throw invalid()
  }
}

/**
 * Own HS256 JWT session, implemented with `node:crypto` (no extra dependency).
 * Claims are `sub`, `iss`, `aud`, `iat` and `exp` (seconds).
 */
export function createSessionService({
  signingKey,
  ttlSeconds,
  now = Date.now
}: {
  signingKey: string
  ttlSeconds: number
  /** Milliseconds since the epoch. */
  now?: () => number
}): SessionService {
  const nowSeconds = (): number => Math.floor(now() / 1000)

  return {
    issue(userId, sessionVersion) {
      const iat = nowSeconds()
      const exp = iat + ttlSeconds
      const payload = {
        sub: userId,
        iss: ISSUER,
        aud: AUDIENCE,
        iat,
        exp,
        ...(sessionVersion === undefined ? {} : { sv: sessionVersion })
      }

      const header = base64url(JSON.stringify(HEADER))
      const body = base64url(JSON.stringify(payload))
      const signature = sign(`${header}.${body}`, signingKey)

      return {
        token: `${header}.${body}.${signature}`,
        expiresAt: new Date(exp * 1000).toISOString()
      }
    },

    verify(token) {
      if (typeof token !== 'string' || token.length === 0) throw invalid()
      const parts = token.split('.')
      if (parts.length !== 3) throw invalid()
      const [headerPart, bodyPart, signaturePart] = parts
      if (
        headerPart === undefined ||
        bodyPart === undefined ||
        signaturePart === undefined
      ) {
        throw invalid()
      }

      if (!isHs256Header(decodeJson(headerPart))) throw invalid()

      const expected = sign(`${headerPart}.${bodyPart}`, signingKey)
      const expectedBytes = Buffer.from(expected)
      const receivedBytes = Buffer.from(signaturePart)
      if (expectedBytes.length !== receivedBytes.length) throw invalid()
      if (!timingSafeEqual(expectedBytes, receivedBytes)) throw invalid()

      const payload = decodeJson(bodyPart)
      if (typeof payload !== 'object' || payload === null) throw invalid()
      const claims = payload as Record<string, unknown>

      const { sub, iss, aud, iat, exp, sv } = claims
      if (typeof sub !== 'string' || sub.length === 0) throw invalid()
      if (iss !== ISSUER) throw invalid()
      if (aud !== AUDIENCE) throw invalid()
      if (typeof iat !== 'number' || typeof exp !== 'number') throw invalid()
      if (exp <= nowSeconds()) throw invalid()

      const sessionVersion = sv === undefined ? 0 : sv
      if (
        typeof sessionVersion !== 'number' ||
        !Number.isInteger(sessionVersion) ||
        sessionVersion < 0
      ) {
        throw invalid()
      }

      return { userId: sub, sessionVersion, iat, exp }
    },

    isRecent(claims, maxAgeSeconds) {
      return nowSeconds() - claims.iat < maxAgeSeconds
    }
  }
}
