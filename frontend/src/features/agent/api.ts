import { apiClient } from '@/api/client';
import type { AgentReply } from './types';

export const AGENT_TIMEOUT_MS = 30_000;

export const agentApi = {
  /** `POST /api/v1/agent/messages` (backend 028). Con `speak`, la respuesta trae el audio. */
  send: (body: { conversationId: string | null; text: string; inputMode: 'text' | 'voice'; speak: boolean }) =>
    apiClient.post<AgentReply>('/agent/messages', body, { timeoutMs: AGENT_TIMEOUT_MS }),
};
