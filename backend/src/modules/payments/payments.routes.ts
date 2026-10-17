import { Router } from 'express'
import type { IdempotencyStore } from '../../shared/idempotency/store.js'
import { idempotency } from '../../shared/middlewares/idempotency.js'
import { requirePaymentsEnabled } from '../../shared/middlewares/payments-enabled.js'
import { userAuth } from '../../shared/middlewares/user-auth.js'
import { validate } from '../../shared/middlewares/validate.js'
import type { EditableSettingsProvider } from '../../shared/settings/editable-settings.js'
import type { SessionService } from '../../shared/session/session.service.js'
import type { UsersRepository } from '../../modules/users/users.repository.js'
import { createPaymentsController } from './payments.controller.js'
import { confirmPaymentBodySchema, createPaymentBodySchema } from './payments.schema.js'
import type { PaymentsService } from './payments.service.js'

export interface PaymentsRouterDependencies {
  service: PaymentsService
  users: UsersRepository
  sessions: SessionService
  idempotencyStore: IdempotencyStore
  settings: Pick<EditableSettingsProvider, 'getEditable'>
}

/**
 * `POST /api/v1/payments` and its confirmation/cancel routes (spec 007). Every
 * route requires the user's own session; cancel remains allowed when payments
 * are disabled.
 */
export function createPaymentsRouter({
  service,
  users,
  sessions,
  idempotencyStore,
  settings
}: PaymentsRouterDependencies): Router {
  const router = Router()
  const controller = createPaymentsController(service)
  const session = userAuth({ sessions, users })
  const paymentsEnabled = requirePaymentsEnabled(settings)

  router.post(
    '/api/v1/payments',
    session,
    paymentsEnabled,
    idempotency(idempotencyStore),
    validate({ body: createPaymentBodySchema }),
    controller.quote
  )

  router.post(
    '/api/v1/payments/:id/confirm/options',
    session,
    paymentsEnabled,
    controller.confirmOptions
  )

  router.post(
    '/api/v1/payments/:id/confirm',
    session,
    paymentsEnabled,
    idempotency(idempotencyStore),
    validate({ body: confirmPaymentBodySchema }),
    controller.confirm
  )

  router.post('/api/v1/payments/:id/cancel', session, controller.cancel)

  return router
}
