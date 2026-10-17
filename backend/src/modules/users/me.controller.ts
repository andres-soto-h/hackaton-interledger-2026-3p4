import type { RequestHandler } from 'express'
import type { ActivityEmitter } from '../../shared/activity/activity-emitter.js'
import { getSessionUser } from '../../shared/middlewares/user-auth.js'
import type { UsersService } from './users.service.js'

export function createMeController(service: UsersService, activity?: ActivityEmitter) {
  const emit: ActivityEmitter = activity ?? (() => Promise.resolve())

  const getMe: RequestHandler = (_req, res) => {
    const { user } = getSessionUser(res)
    res.status(200).json(service.toPublicUser(user))
  }

  const deleteMe: RequestHandler = async (_req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      await service.deleteAccount(user.id)
      await emit({
        type: 'user.deleted',
        message: 'User deleted',
        data: { userId: user.id }
      })
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  }

  return { getMe, deleteMe }
}
