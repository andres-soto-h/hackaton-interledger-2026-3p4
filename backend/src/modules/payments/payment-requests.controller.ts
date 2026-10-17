import type { RequestHandler } from 'express'
import type { CreatePaymentRequestBody } from './payment-requests.schema.js'
import type { PaymentRequestsService } from './payment-requests.service.js'

export interface PaymentRequestsController {
  create: RequestHandler
}

/** Thin HTTP adapter: delegates to the service and maps errors to the handler. */
export function createPaymentRequestsController(
  service: PaymentRequestsService
): PaymentRequestsController {
  const create: RequestHandler = async (req, res, next) => {
    try {
      const body = await service.create(req.body as CreatePaymentRequestBody)
      res.status(201).json(body)
    } catch (error) {
      next(error)
    }
  }

  return { create }
}
