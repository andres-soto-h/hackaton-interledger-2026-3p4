import type { AgentHistoryMessage } from './agent.types.js'

export interface Conversation {
  id: string
  userId: string
  messages: AgentHistoryMessage[]
  /** TTL in epoch seconds. */
  expiresAt: number
}

export interface ConversationsRepository {
  /** `null` when it does not exist, has expired or belongs to someone else. */
  get(id: string, userId: string, nowSeconds: number): Promise<Conversation | null>
  save(conversation: Conversation): Promise<void>
}
