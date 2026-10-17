import { apiClient } from '@/api/client';
import type { AgentReply } from './types';

export const AGENT_TIMEOUT_MS = 30_000;

export const agentApi = {
  /** Contrato propuesto (sin spec en el backend todavía): ver frontend spec 008. */
  send: (body: { conversationId: string | null; text: string; inputMode: 'text' | 'voice' }) =>
    apiClient.post<AgentReply>('/agent/messages', body, { timeoutMs: AGENT_TIMEOUT_MS }),
};
