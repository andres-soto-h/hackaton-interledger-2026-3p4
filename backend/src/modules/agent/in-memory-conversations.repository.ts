import type { Conversation, ConversationsRepository } from './conversations.repository.js'

export function createInMemoryConversationsRepository(): ConversationsRepository {
  const items = new Map<string, Conversation>()
  return {
    get(id, userId, nowSeconds) {
      const found = items.get(id)
      if (
        found === undefined ||
        found.userId !== userId ||
        found.expiresAt <= nowSeconds
      ) {
        return Promise.resolve(null)
      }
      return Promise.resolve(found)
    },
    save(conversation) {
      items.set(conversation.id, conversation)
      return Promise.resolve()
    }
  }
}
