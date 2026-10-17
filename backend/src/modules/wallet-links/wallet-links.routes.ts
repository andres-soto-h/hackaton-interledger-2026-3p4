import { Router } from 'express'
import { z } from 'zod'
import { requireRecentSession, userAuth } from '../../shared/middlewares/user-auth.js'
import { validate } from '../../shared/middlewares/validate.js'
import type { SessionService } from '../../shared/session/session.service.js'
import type { UsersRepository } from '../users/users.repository.js'
import { createWalletLinksController } from './wallet-links.controller.js'
import type { WalletLinksService } from './wallet-links.service.js'

const callbackQuerySchema = z.object({
  linkId: z.string(),
  interact_ref: z.string().optional(),
  hash: z.string().optional(),
  result: z.string().optional()
})

export function createWalletLinksRouter({
  service,
  users,
  sessions,
  frontendResultUrl
}: {
  service: WalletLinksService
  users: UsersRepository
  sessions: SessionService
  frontendResultUrl?: string
}): Router {
  const controller = createWalletLinksController(service, frontendResultUrl)
  const router = Router()
  const auth = userAuth({ sessions, users })

  router.post('/api/v1/me/wallet-link', auth, controller.startLink)
  router.get('/api/v1/me/wallet-link', auth, controller.getLink)
  router.delete(
    '/api/v1/me/wallet-link',
    auth,
    requireRecentSession(sessions),
    controller.unlink
  )
  router.get('/api/v1/me/allowance', auth, controller.getAllowance)
  router.get(
    '/api/v1/auth/callback',
    validate({ query: callbackQuerySchema }),
    controller.callback
  )

  return router
}
