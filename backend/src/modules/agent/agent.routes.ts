import { Router } from 'express'
import { getSessionUser, userAuth } from '../../shared/middlewares/user-auth.js'
import { validate } from '../../shared/middlewares/validate.js'
import type { SessionService } from '../../shared/session/session.service.js'
import type { UsersRepository } from '../users/users.repository.js'
import { agentMessageBodySchema, type AgentMessageBody } from './agent.schema.js'
import type { AgentService } from './agent.service.js'

/**
 * `POST /api/v1/agent/messages` (spec 028): one turn with the assistant. The
 * session token is handed to the agent so it calls the API as the user.
 */
export function createAgentRouter(deps: {
  service: AgentService
  users: UsersRepository
  sessions: SessionService
}): Router {
  const router = Router()
  const session = userAuth({ sessions: deps.sessions, users: deps.users })

  router.post(
    '/api/v1/agent/messages',
    session,
    validate({ body: agentMessageBodySchema }),
    async (req, res, next) => {
      try {
        const { user } = getSessionUser(res)
        const token = (req.headers['authorization'] ?? '')
          .replace(/^Bearer\s+/, '')
          .trim()
        const body = req.body as AgentMessageBody
        res.status(200).json(await deps.service.sendMessage({ user, token, body }))
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}
