import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { agentApi } from './api';
import {
  conversationReducer,
  failedUserText,
  initialConversation,
  type ConversationState,
} from './conversation';
import { createWebSpeechOutput } from '@/features/voice/speech-output';
import { parseActions, type ChatMessage } from './types';

type AgentContextValue = {
  messages: ConversationState['messages'];
  status: ConversationState['status'];
  send: (text: string, inputMode?: 'text' | 'voice') => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
  /** Respuestas habladas: se activan al hablar y se pueden silenciar. */
  spokenReplies: boolean;
  setSpokenReplies: (on: boolean) => void;
  /** Escucha de nuevo una respuesta (audio de ElevenLabs o, sin audio, la voz del dispositivo). */
  speak: (message: ChatMessage) => void;
  stopSpeaking: () => void;
  /** Recuerda que el pago salió del chat para mostrar su estado al volver. */
  markFromChat: (paymentId: string) => void;
  isFromChat: (paymentId: string) => boolean;
  /** Agrega la tarjeta de estado del pago al chat (una sola vez por pago). */
  reportPaymentStatus: (paymentId: string) => void;
};

const AgentContext = createContext<AgentContextValue | null>(null);

/** Conversación en memoria durante la sesión (no se guarda entre sesiones). */
export function AgentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(conversationReducer, initialConversation);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const output = useMemo(() => createWebSpeechOutput(), []);
  const [spokenReplies, setSpoken] = useState(false);
  const spokenRef = useRef(false);
  const counter = useRef(0);
  const fromChat = useRef(new Set<string>());
  const reported = useRef(new Set<string>());
  const nextId = (prefix: string) => `${prefix}-${(counter.current += 1)}`;

  const ask = useCallback(async (pendingId: string, text: string, inputMode: 'text' | 'voice') => {
    try {
      const res = await agentApi.send({
        conversationId: stateRef.current.conversationId,
        text,
        inputMode,
        speak: spokenRef.current,
      });
      dispatch({
        type: 'reply',
        pendingId,
        conversationId: res.conversationId,
        id: res.reply.id,
        text: res.reply.text,
        actions: parseActions(res.actions),
        audio: res.reply.audio?.base64,
      });
      if (spokenRef.current) {
        // El audio de ElevenLabs es lo normal; sin audio se lee con la voz del dispositivo.
        const played = res.reply.audio
          ? output.playAudio(res.reply.audio.base64)
          : Promise.reject(new Error('sin audio'));
        // Si el navegador bloquea la reproducción, queda el botón "Escuchar" en la burbuja.
        played.catch(() => {
          if (!res.reply.audio) output.speakText(res.reply.text);
        });
      }
    } catch {
      dispatch({ type: 'fail', pendingId });
    }
  }, [output]);

  const setSpokenReplies = useCallback(
    (on: boolean) => {
      spokenRef.current = on;
      setSpoken(on);
      if (!on) output.stop();
    },
    [output],
  );

  const speak = useCallback(
    (message: ChatMessage) => {
      if (message.audio) output.playAudio(message.audio).catch(() => output.speakText(message.text));
      else output.speakText(message.text);
    },
    [output],
  );

  const send = useCallback(
    async (text: string, inputMode: 'text' | 'voice' = 'text') => {
      const clean = text.trim();
      if (!clean || clean.length > 500 || stateRef.current.status === 'sending') return;
      // Hablar activa las respuestas habladas; la persona las puede silenciar.
      if (inputMode === 'voice') setSpokenReplies(true);
      output.stop();
      const pendingId = nextId('pending');
      dispatch({ type: 'send', userId: nextId('user'), pendingId, text: clean });
      await ask(pendingId, clean, inputMode);
    },
    [ask, output, setSpokenReplies],
  );

  const retry = useCallback(async () => {
    const text = failedUserText(stateRef.current);
    if (!text) return;
    const pendingId = nextId('pending');
    dispatch({ type: 'retry', pendingId });
    await ask(pendingId, text, 'text');
  }, [ask]);

  const value = useMemo<AgentContextValue>(
    () => ({
      messages: state.messages,
      status: state.status,
      send,
      retry,
      spokenReplies,
      setSpokenReplies,
      speak,
      stopSpeaking: output.stop,
      reset: () => {
        output.stop();
        fromChat.current.clear();
        reported.current.clear();
        dispatch({ type: 'reset' });
      },
      markFromChat: (id) => void fromChat.current.add(id),
      isFromChat: (id) => fromChat.current.has(id),
      reportPaymentStatus: (id) => {
        if (!fromChat.current.has(id) || reported.current.has(id)) return;
        reported.current.add(id);
        dispatch({
          type: 'add-agent',
          id: nextId('status'),
          text: 'Así quedó su pago:',
          actions: [{ type: 'payment_status', paymentId: id }],
        });
      },
    }),
    [state.messages, state.status, send, retry, spokenReplies, setSpokenReplies, speak, output],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error('useAgent necesita <AgentProvider>');
  return value;
}
