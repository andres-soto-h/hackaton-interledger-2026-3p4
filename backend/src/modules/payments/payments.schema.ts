import { z } from 'zod'
import {
  amountSchema,
  descriptionSchema,
  walletAddressSchema
} from '../../shared/validation/schemas.js'

const incomingPaymentUrlSchema = z.string().max(2048).url()

const p2pSchema = z.strictObject({
  type: z.literal('p2p'),
  receiverWalletAddress: walletAddressSchema,
  amount: amountSchema,
  description: descriptionSchema
})

const p2mSchema = z.strictObject({
  type: z.literal('p2m'),
  incomingPaymentUrl: incomingPaymentUrlSchema,
  amount: amountSchema.optional(),
  description: descriptionSchema
})

/**
 * Strict body of `POST /api/v1/payments` (spec 007). The two variants are
 * exclusive: `p2p` fixes the receiver wallet and requires an amount, while
 * `p2m` points at an existing incoming payment (amount only when it has none).
 * The sender always comes from the session, never from the body.
 */
export const createPaymentBodySchema = z.discriminatedUnion('type', [
  p2pSchema,
  p2mSchema
])

export type CreatePaymentBody = z.infer<typeof createPaymentBodySchema>

/** The WebAuthn credential is opaque: it is validated as an object and passed intact. */
const credentialSchema = z.object({}).passthrough()

/** Strict body of `POST /api/v1/payments/{id}/confirm` (spec 007). */
export const confirmPaymentBodySchema = z.strictObject({
  challengeId: z.string(),
  credential: credentialSchema
})

export type ConfirmPaymentBody = z.infer<typeof confirmPaymentBodySchema>
