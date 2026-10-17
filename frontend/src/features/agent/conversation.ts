import type { AgentAction, ChatMessage } from './types';

export type ConversationState = {
  conversationId: string | null;
  messages: ChatMessage[];
  status: 'idle' | 'sending' | 'error';
};

export type ConversationEvent =
  | { type: 'send'; userId: string; pendingId: string; text: string }
  | { type: 'reply'; pendingId: string; conversationId: string; id: string; text: string; actions: AgentAction[] }
  | { type: 'fail'; pendingId: string }
  | { type: 'retry'; pendingId: string }
  | { type: 'add-agent'; id: string; text: string; actions?: AgentAction[] }
  | { type: 'reset' };

export const initialConversation: ConversationState = { conversationId: null, messages: [], status: 'idle' };

const pendingBubble = (id: string): ChatMessage => ({ id, role: 'agent', text: '', pending: true });

export function conversationReducer(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.type) {
    case 'send':
      return {
        ...state,
        status: 'sending',
        messages: [
          ...state.messages,
          { id: event.userId, role: 'user', text: event.text },
          pendingBubble(event.pendingId),
        ],
      };
    case 'reply':
      return {
        conversationId: event.conversationId,
        status: 'idle',
        messages: state.messages.map((m) =>
          m.id === event.pendingId
            ? { id: event.id, role: 'agent', text: event.text, actions: event.actions }
            : m,
        ),
      };
    case 'fail': {
      // El mensaje del usuario se conserva; la burbuja pendiente pasa a error.
      const idx = state.messages.findIndex((m) => m.id === event.pendingId);
      return {
        ...state,
        status: 'error',
        messages: state.messages.map((m, i) =>
          i === idx - 1 ? { ...m, failed: true } : i === idx ? { ...m, pending: false, failed: true } : m,
        ),
      };
    }
    case 'retry': {
      const idx = state.messages.findIndex((m) => m.failed && m.role === 'agent');
      if (idx < 0) return state;
      return {
        ...state,
        status: 'sending',
        messages: state.messages.map((m, i) =>
          i === idx
            ? { ...pendingBubble(event.pendingId) }
            : i === idx - 1
              ? { ...m, failed: false }
              : m,
        ),
      };
    }
    case 'add-agent':
      return {
        ...state,
        messages: [...state.messages, { id: event.id, role: 'agent', text: event.text, actions: event.actions }],
      };
    case 'reset':
      return initialConversation;
  }
}

/** Texto del último mensaje del usuario que no obtuvo respuesta (para reintentar). */
export function failedUserText(state: ConversationState): string | null {
  const idx = state.messages.findIndex((m) => m.failed && m.role === 'agent');
  return idx > 0 ? state.messages[idx - 1].text : null;
}
