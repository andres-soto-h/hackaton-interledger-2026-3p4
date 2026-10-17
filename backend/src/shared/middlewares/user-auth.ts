import type { RequestHandler, Response } from 'express'
import type { User } from '../../modules/users/user.types.js'
import type { UsersRepository } from '../../modules/users/users.repository.js'
import { AppError } from '../errors/app-error.js'
import type { SessionClaims, SessionService } from '../session/session.service.js'

export interface SessionContext {
  user: User
  claims: SessionClaims
}

const USER_KEY = 'sessionUser'
const CLAIMS_KEY = 'sessionClaims'

const sessionInvalid = (): AppError =>
  new AppError(401, 'SESSION_INVALID', 'Invalid or expired session')

const reauthRequired = (): AppError =>
  new AppError(401, 'REAUTH_REQUIRED', 'Session too old, please re-authenticate')

/** Reads the user and claims stored by `userAuth`. Throws `SESSION_INVALID` if absent. */
export const getSessionUser = (res: Response): SessionContext => {
  const user = res.locals[USER_KEY] as User | undefined
  const claims = res.locals[CLAIMS_KEY] as SessionClaims | undefined
  if (user === undefined || claims === undefined) throw sessionInvalid()
  return { user, claims }
}

/**
 * Requires `Authorization: Bearer <token>`, verifies the JWT and checks that
 * the account still exists and is `ACTIVE`. Stores the user and claims for
 * `getSessionUser(res)`.
 */
export function userAuth({
  sessions,
  users
}: {
  sessions: SessionService
  users: UsersRepository
}): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      next(sessionInvalid())
      return
    }
    const token = header.slice('Bearer '.length).trim()
    if (token.length === 0) {
      next(sessionInvalid())
      return
    }

    let claims: SessionClaims
    try {
      claims = sessions.verify(token)
    } catch (error) {
      next(error instanceof AppError ? error : sessionInvalid())
      return
    }

    const user = await users.getUser(claims.userId)
    if (user === null || user.status !== 'ACTIVE') {
      next(sessionInvalid())
      return
    }

    if (claims.sessionVersion !== (user.sessionVersion ?? 0)) {
      next(sessionInvalid())
      return
    }

    res.locals[USER_KEY] = user
    res.locals[CLAIMS_KEY] = claims
    next()
  }
}

/**
 * Requires a session issued at most `maxAgeSeconds` ago (default 5 minutes).
 * Runs after `userAuth`; otherwise it responds `SESSION_INVALID`.
 */
export function requireRecentSession(
  sessions: SessionService,
  maxAgeSeconds = 300
): RequestHandler {
  return (_req, res, next) => {
    try {
      const context = getSessionUser(res)
      if (!sessions.isRecent(context.claims, maxAgeSeconds)) {
        next(reauthRequired())
        return
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}
