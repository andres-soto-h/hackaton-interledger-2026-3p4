import type { RequestHandler } from 'express'
import { getSessionUser } from '../../shared/middlewares/user-auth.js'
import type { ConfirmPaymentBody, CreatePaymentBody } from './payments.schema.js'
import type { PaymentsService } from './payments.service.js'

export interface PaymentsController {
  quote: RequestHandler
  confirmOptions: RequestHandler
  confirm: RequestHandler
  cancel: RequestHandler
}

/** Thin HTTP adapter: delegates to the service and maps errors to the handler. */
export function createPaymentsController(service: PaymentsService): PaymentsController {
  const quote: RequestHandler = async (req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      res.status(201).json(await service.quote(user, req.body as CreatePaymentBody))
    } catch (error) {
      next(error)
    }
  }

  const confirmOptions: RequestHandler = async (req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      res.status(200).json(await service.confirmOptions(user, req.params.id as string))
    } catch (error) {
      next(error)
    }
  }

  const confirm: RequestHandler = async (req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      const body = req.body as ConfirmPaymentBody
      const result = await service.confirm(user, req.params.id as string, body)
      res.set('Retry-After', '2').status(202).json(result)
    } catch (error) {
      next(error)
    }
  }

  const cancel: RequestHandler = async (req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      await service.cancel(user, req.params.id as string)
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  }

  return { quote, confirmOptions, confirm, cancel }
}
