import { Router } from 'express'
import { getSessionUser, userAuth } from '../../shared/middlewares/user-auth.js'
import type { SessionService } from '../../shared/session/session.service.js'
import type { UsersRepository } from '../users/users.repository.js'
import type { PaymentStatusService } from './payment-status.service.js'

/**
 * `GET /api/v1/payments/{id}` (spec 008): the account's own session reads the
 * status of a payment, refreshing it against Open Payments when needed.
 */
export function createPaymentStatusRouter(deps: {
  service: PaymentStatusService
  users: UsersRepository
  sessions: SessionService
}): Router {
  const router = Router()
  const session = userAuth({ sessions: deps.sessions, users: deps.users })

  router.get('/api/v1/payments/:id', session, async (req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      res.status(200).json(await deps.service.getStatus(user, req.params.id as string))
    } catch (error) {
      next(error)
    }
  })

  return router
}
