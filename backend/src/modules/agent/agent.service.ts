import { AppError } from '../../shared/errors/app-error.js'
import { newConversationId, newMessageId } from '../../shared/ids/ids.js'
import type { Logger } from '../../shared/logger.js'
import type { User } from '../users/user.types.js'
import {
  agentReplySchema,
  type AgentAction,
  type AgentGateway,
  type AgentHistoryMessage
} from './agent.types.js'
import type { ConversationsRepository } from './conversations.repository.js'
import type { AgentMessageBody } from './agent.schema.js'

/** Turns kept per conversation, and how long an idle conversation lives. */
const MAX_HISTORY_MESSAGES = 20
const CONVERSATION_TTL_SECONDS = 2 * 3600

export interface AgentMessageResponse {
  conversationId: string
  reply: {
    id: string
    text: string
    audio?: { format: 'mp3'; base64: string }
    audioUnavailable?: boolean
  }
  actions: AgentAction[]
}

export interface AgentService {
  sendMessage(input: {
    user: User
    token: string
    body: AgentMessageBody
  }): Promise<AgentMessageResponse>
}

const unavailable = (): AppError =>
  new AppError(503, 'AGENT_UNAVAILABLE', 'The assistant is not available right now')

export function createAgentService({
  gateway,
  conversations,
  allow,
  now = Date.now,
  logger
}: {
  /** `null`: the agent is not configured in this environment. */
  gateway: AgentGateway | null
  conversations: ConversationsRepository
  /** Per-user rate limit; returns `false` when the user went over it. */
  allow: (userId: string) => boolean
  now?: () => number
  logger: Logger
}): AgentService {
  return {
    async sendMessage({ user, token, body }) {
      if (gateway === null) throw unavailable()
      if (!allow(user.id)) {
        throw new AppError(
          429,
          'AGENT_RATE_LIMITED',
          'Too many messages, try again in a moment'
        )
      }

      const nowSeconds = Math.floor(now() / 1000)
      const existing =
        body.conversationId !== null && body.conversationId !== undefined
          ? await conversations.get(body.conversationId, user.id, nowSeconds)
          : null
      const conversationId = existing?.id ?? newConversationId(now())
      const history = existing?.messages ?? []

      const started = now()
      let reply
      try {
        const raw = await gateway.invoke({
          userToken: token,
          userId: user.id,
          text: body.text,
          inputMode: body.inputMode,
          speak: body.speak,
          history
        })
        reply = agentReplySchema.parse(raw)
      } catch (error) {
        // Never log the text or the token: only who, which conversation and how long.
        logger.error(
          { err: error, userId: user.id, conversationId, durationMs: now() - started },
          'Agent invocation failed'
        )
        throw unavailable()
      }
      logger.info(
        {
          userId: user.id,
          conversationId,
          durationMs: now() - started,
          actions: reply.actions.map((action) => action.type),
          audio: reply.audio !== undefined
        },
        'Agent turn'
      )

      const messages: AgentHistoryMessage[] = [
        ...history,
        { role: 'user' as const, text: body.text },
        { role: 'assistant' as const, text: reply.text }
      ].slice(-MAX_HISTORY_MESSAGES)
      await conversations.save({
        id: conversationId,
        userId: user.id,
        messages,
        expiresAt: nowSeconds + CONVERSATION_TTL_SECONDS
      })

      return {
        conversationId,
        reply: {
          id: newMessageId(now()),
          text: reply.text,
          ...(reply.audio !== undefined ? { audio: reply.audio } : {}),
          ...(reply.audioUnavailable === true ? { audioUnavailable: true } : {})
        },
        actions: reply.actions
      }
    }
  }
}
