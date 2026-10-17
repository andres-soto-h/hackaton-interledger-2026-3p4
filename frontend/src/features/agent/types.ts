export type AgentAction =
  | { type: 'confirm_payment'; paymentId: string }
  | { type: 'payment_status'; paymentId: string }
  | { type: 'choose_merchant'; options: { merchantId: string; label: string }[] };

export type AgentReply = {
  conversationId: string;
  reply: {
    id: string;
    text: string;
    /** Voz de ElevenLabs (backend 028); solo con `speak: true`. */
    audio?: { format: 'mp3'; base64: string };
    /** Se pidió audio y no se pudo generar: el texto llega igual. */
    audioUnavailable?: boolean;
  };
  actions?: unknown[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  actions?: AgentAction[];
  /** Audio mp3 (base64) de la respuesta; permite "Escuchar" si el navegador bloqueó la reproducción. */
  audio?: string;
  /** El agente está "escribiendo…". */
  pending?: boolean;
  /** El mensaje del usuario no obtuvo respuesta (se puede reintentar). */
  failed?: boolean;
};

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Acepta solo las acciones conocidas y bien formadas; lo demás se ignora sin romper. */
export function parseActions(raw: unknown): AgentAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: AgentAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if ((a.type === 'confirm_payment' || a.type === 'payment_status') && isString(a.paymentId)) {
      actions.push({ type: a.type, paymentId: a.paymentId });
    } else if (a.type === 'choose_merchant' && Array.isArray(a.options)) {
      const options = a.options
        .filter((o): o is { merchantId: string; label: string } => !!o && isString((o as Record<string, unknown>).merchantId) && isString((o as Record<string, unknown>).label))
        .map((o) => ({ merchantId: o.merchantId, label: o.label }));
      if (options.length > 0) actions.push({ type: 'choose_merchant', options });
    }
  }
  return actions;
}
