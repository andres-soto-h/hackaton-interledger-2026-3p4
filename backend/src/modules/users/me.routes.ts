import { Router } from 'express'
import { requireRecentSession, userAuth } from '../../shared/middlewares/user-auth.js'
import type { SessionService } from '../../shared/session/session.service.js'
import { createMeController } from './me.controller.js'
import type { UsersRepository } from './users.repository.js'
import { createUsersService } from './users.service.js'

export function createMeRouter({
  users,
  sessions,
  beforeDeleteAccount
}: {
  users: UsersRepository
  sessions: SessionService
  /** Runs before the account and its credentials are deleted (spec 023). */
  beforeDeleteAccount?: (userId: string) => Promise<void>
}): Router {
  const service = createUsersService(users, beforeDeleteAccount)
  const controller = createMeController(service)
  const router = Router()

  router.get('/api/v1/me', userAuth({ sessions, users }), controller.getMe)
  router.delete(
    '/api/v1/me',
    userAuth({ sessions, users }),
    requireRecentSession(sessions),
    controller.deleteMe
  )

  return router
}
