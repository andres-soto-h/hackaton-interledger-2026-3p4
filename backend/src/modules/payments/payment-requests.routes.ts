import { Router } from 'express'
import type { IdempotencyStore } from '../../shared/idempotency/store.js'
import { idempotency } from '../../shared/middlewares/idempotency.js'
import { validate } from '../../shared/middlewares/validate.js'
import { createPaymentRequestsController } from './payment-requests.controller.js'
import { createPaymentRequestBodySchema } from './payment-requests.schema.js'
import type { PaymentRequestsService } from './payment-requests.service.js'

export interface PaymentRequestsRouterDependencies {
  service: PaymentRequestsService
  idempotencyStore: IdempotencyStore
}

/** `POST /api/v1/payment-requests` (spec 006). No user session required. */
export function createPaymentRequestsRouter({
  service,
  idempotencyStore
}: PaymentRequestsRouterDependencies): Router {
  const router = Router()
  const controller = createPaymentRequestsController(service)

  router.post(
    '/api/v1/payment-requests',
    idempotency(idempotencyStore),
    validate({ body: createPaymentRequestBodySchema }),
    controller.create
  )

  return router
}
