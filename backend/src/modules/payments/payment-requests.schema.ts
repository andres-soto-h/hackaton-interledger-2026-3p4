import { z } from 'zod'
import {
  amountSchema,
  descriptionSchema,
  walletAddressSchema
} from '../../shared/validation/schemas.js'

/** Strict body of `POST /api/v1/payment-requests` (spec 006). */
export const createPaymentRequestBodySchema = z.strictObject({
  type: z.enum(['p2p', 'p2m']),
  receiverWalletAddress: walletAddressSchema,
  amount: amountSchema.optional(),
  description: descriptionSchema,
  expiresInSeconds: z.number().int().min(60).max(86400).default(900)
})

export type CreatePaymentRequestBody = z.infer<typeof createPaymentRequestBodySchema>
