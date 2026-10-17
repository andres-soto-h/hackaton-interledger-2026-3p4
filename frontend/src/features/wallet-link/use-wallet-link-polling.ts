import { useQuery } from '@tanstack/react-query';
import { walletLinkApi } from './api';
import { nextPollDelayMs } from './polling';

export const walletLinkPollKey = ['me', 'wallet-link', 'poll'] as const;

/** Consulta la vinculación respetando `Retry-After` hasta que llegue a un estado final. */
export function useWalletLinkPolling() {
  return useQuery({
    queryKey: walletLinkPollKey,
    queryFn: walletLinkApi.getPolled,
    refetchInterval: (query) =>
      nextPollDelayMs(query.state.data?.link, query.state.data?.retryAfterSeconds),
  });
}
