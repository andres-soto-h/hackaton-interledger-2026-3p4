import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { fixtures } from '../../../tests/msw/auth';
import { nextPollDelayMs } from './polling';
import { useWalletLinkPolling } from './use-wallet-link-polling';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = { ...fixtures.walletLink, status: 'PENDING_AUTHORIZATION', isFinal: false } as const;
const active = fixtures.walletLink;

describe('nextPollDelayMs', () => {
  it('usa Retry-After y, sin él, 2 s', () => {
    expect(nextPollDelayMs(pending, 5)).toBe(5000);
    expect(nextPollDelayMs(pending, undefined)).toBe(2000);
  });

  it('se detiene en un estado final', () => {
    expect(nextPollDelayMs(active, 2)).toBe(false);
    expect(nextPollDelayMs(null, undefined)).toBe(false);
  });
});

describe('useWalletLinkPolling', () => {
  it('consulta cada Retry-After y se detiene al llegar a un estado final', async () => {
    let requests = 0;
    server.use(
      http.get(`${API}/me/wallet-link`, () => {
        requests += 1;
        return requests < 2
          ? HttpResponse.json(pending, { headers: { 'Retry-After': '1' } })
          : HttpResponse.json(active);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = await renderHook(() => useWalletLinkPolling(), { wrapper });

    await waitFor(() => expect(result.current.data?.link?.status).toBe('PENDING_AUTHORIZATION'));
    expect(requests).toBe(1);
    await sleep(500);
    expect(requests).toBe(1); // todavía no pasó el segundo del Retry-After

    await waitFor(() => expect(result.current.data?.link?.status).toBe('ACTIVE'), { timeout: 2500 });
    expect(requests).toBe(2);
    await sleep(1300);
    expect(requests).toBe(2); // estado final: no sigue consultando
  });
});
