import { z } from 'zod'
import { paginationQuerySchema } from '../../shared/validation/schemas.js'

/**
 * Strict query of `GET /api/v1/transactions` (spec 008). The wallet always
 * comes from the account's session, so an unknown key such as `walletAddress`
 * is rejected.
 */
export const transactionsQuerySchema = paginationQuerySchema
  .extend({
    direction: z.enum(['incoming', 'outgoing', 'all']).default('all'),
    kind: z.enum(['payment', 'payment-request', 'all']).default('all'),
    status: z.string().optional()
  })
  .strict()

export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>
