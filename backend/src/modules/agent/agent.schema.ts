import { z } from 'zod'

/** Strict body of `POST /api/v1/agent/messages` (spec 028). */
export const agentMessageBodySchema = z.strictObject({
  conversationId: z
    .string()
    .regex(/^conv_[0-9A-Z]{26}$/)
    .nullable()
    .optional(),
  text: z.string().trim().min(1).max(500),
  inputMode: z.enum(['text', 'voice']).default('text'),
  speak: z.boolean().default(false)
})

export type AgentMessageBody = z.infer<typeof agentMessageBodySchema>
