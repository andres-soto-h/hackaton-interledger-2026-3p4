import { z } from 'zod'

/** One turn kept in the short conversation history (spec 028). */
export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  text: string
}

/**
 * What the app does after a reply. Built by the agent from real tool results
 * (never from model text); validated again here before reaching the client.
 */
export const agentActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('confirm_payment'),
    paymentId: z.string().regex(/^pay_/)
  }),
  z.strictObject({
    type: z.literal('payment_status'),
    paymentId: z.string().regex(/^pay_/)
  }),
  z.strictObject({
    type: z.literal('choose_merchant'),
    options: z
      .array(z.strictObject({ merchantId: z.string().min(1), label: z.string().min(1) }))
      .max(10)
  })
])

export type AgentAction = z.infer<typeof agentActionSchema>

/** Reply of the agent function: text, actions and (optionally) the voice. */
export const agentReplySchema = z.object({
  text: z.string().min(1).max(2000),
  actions: z.array(agentActionSchema).max(5).default([]),
  audio: z
    .strictObject({ format: z.literal('mp3'), base64: z.string().min(1) })
    .optional(),
  audioUnavailable: z.boolean().optional()
})

export type AgentReply = z.infer<typeof agentReplySchema>

export interface AgentInvokeInput {
  /** The user's own session token: the agent calls the API on their behalf. */
  userToken: string
  userId: string
  text: string
  inputMode: 'text' | 'voice'
  speak: boolean
  history: AgentHistoryMessage[]
}

/** Port to the agent function (spec 028). The real adapter invokes a Lambda. */
export interface AgentGateway {
  invoke(input: AgentInvokeInput): Promise<unknown>
}
