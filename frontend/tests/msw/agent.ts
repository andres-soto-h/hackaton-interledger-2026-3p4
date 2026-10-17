import { http, HttpResponse } from 'msw';
import { API } from './config';

export type AgentBody = { conversationId: string | null; text: string; inputMode: string };

/** Guion simple: responde según el texto; `bodies` registra lo que mandó la app. */
export function agentHandler(
  respond: (body: AgentBody, n: number) => Record<string, unknown> | Response,
  bodies: AgentBody[] = [],
) {
  return http.post(`${API}/agent/messages`, async ({ request }) => {
    const body = (await request.json()) as AgentBody;
    bodies.push(body);
    const out = respond(body, bodies.length);
    return out instanceof Response ? out : HttpResponse.json(out);
  });
}

export const reply = (text: string, actions: unknown[] = [], conversationId = 'conv_1') => ({
  conversationId,
  reply: { id: `msg_${Math.random().toString(36).slice(2, 8)}`, text },
  actions,
});

export const agentHandlers = [agentHandler((b) => reply(`Recibí: ${b.text}`))];
