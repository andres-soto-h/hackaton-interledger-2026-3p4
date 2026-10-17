import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../shared/middlewares/validate.js'
import { createAuthController } from './auth.controller.js'
import { createAuthService, type AuthDeps } from './auth.service.js'

/** The credential is opaque (WebAuthn payload): only `id` is required. */
const credentialSchema = z.looseObject({ id: z.string().min(1) })

const registerOptionsSchema = z.union([
  z.strictObject({
    displayName: z.string().min(1).max(60),
    email: z.string().email().optional(),
    walletAddress: z.string().min(1)
  }),
  z.strictObject({
    enrollmentToken: z.string().regex(/^[0-9a-f]{64}$/)
  })
])

const registerVerifySchema = z.strictObject({
  challengeId: z.string(),
  credential: credentialSchema
})

const loginVerifySchema = z.strictObject({
  challengeId: z.string(),
  credential: credentialSchema
})

/** `/login/options` takes no body, or only the account email (logs in with that account's passkeys). */
const loginOptionsSchema = z.union([
  z.undefined(),
  z.strictObject({ email: z.string().email().optional() })
])

export function createAuthRouter(deps: AuthDeps): Router {
  const service = createAuthService(deps)
  const controller = createAuthController(service)
  const router = Router()

  router.post(
    '/api/v1/auth/register/options',
    validate({ body: registerOptionsSchema }),
    controller.registerOptions
  )
  router.post(
    '/api/v1/auth/register/verify',
    validate({ body: registerVerifySchema }),
    controller.registerVerify
  )
  router.post(
    '/api/v1/auth/login/options',
    validate({ body: loginOptionsSchema }),
    controller.loginOptions
  )
  router.post(
    '/api/v1/auth/login/verify',
    validate({ body: loginVerifySchema }),
    controller.loginVerify
  )

  return router
}
