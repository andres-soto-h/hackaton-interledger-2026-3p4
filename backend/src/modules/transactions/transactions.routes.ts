import { Router } from 'express'
import { getSessionUser, userAuth } from '../../shared/middlewares/user-auth.js'
import { validate } from '../../shared/middlewares/validate.js'
import type { SessionService } from '../../shared/session/session.service.js'
import type { UsersRepository } from '../users/users.repository.js'
import { transactionsQuerySchema, type TransactionsQuery } from './transactions.schema.js'
import type { TransactionsService } from './transactions.service.js'

/**
 * `GET /api/v1/transactions` (spec 008): lists the account's own payments and
 * payment requests with filters and cursor pagination.
 */
export function createTransactionsRouter(deps: {
  service: TransactionsService
  users: UsersRepository
  sessions: SessionService
}): Router {
  const router = Router()
  const session = userAuth({ sessions: deps.sessions, users: deps.users })

  router.get(
    '/api/v1/transactions',
    session,
    validate({ query: transactionsQuerySchema }),
    async (req, res, next) => {
      try {
        const { user } = getSessionUser(res)
        const query = req.query as unknown as TransactionsQuery
        res.status(200).json(await deps.service.list(user, query))
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}
