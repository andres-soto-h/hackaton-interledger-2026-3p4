import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError } from '../../../tests/msw/auth';
import { makePayment } from '../../../tests/msw/transactions';
import { usePaymentStatus } from './use-payment-status';

const processing = (retry: string) =>
  HttpResponse.json(makePayment({ paymentId: 'pay_1', status: 'PROCESSING', isFinal: false }), {
    headers: { 'Retry-After': retry },
  });
const completed = () => HttpResponse.json(makePayment({ paymentId: 'pay_1', status: 'COMPLETED', isFinal: true }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePaymentStatus('pay_1', { maxMs: 120_000 }), { wrapper });
}

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

describe('usePaymentStatus', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('respeta Retry-After (2 s, luego 5 s) y se detiene en un estado final', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/payments/pay_1`, () => {
        calls += 1;
        return calls === 1 ? processing('2') : calls === 2 ? processing('5') : completed();
      }),
    );
    const { result } = await setup();
    await advance(100);
    expect(calls).toBe(1);
    expect(result.current.phase).toBe('polling');

    await advance(1500);
    expect(calls).toBe(1); // faltan ~0,4 s del primer Retry-After
    await advance(600);
    expect(calls).toBe(2);

    await advance(4000);
    expect(calls).toBe(2); // el segundo Retry-After es de 5 s
    await advance(1500);
    expect(calls).toBe(3);
    expect(result.current.phase).toBe('final');
    expect(result.current.payment?.status).toBe('COMPLETED');

    await advance(60_000);
    expect(calls).toBe(3);
  });

  it('sin estado final en 2 minutos pasa a timeout, deja de consultar y retry reanuda', async () => {
    let calls = 0;
    server.use(http.get(`${API}/payments/pay_1`, () => ((calls += 1), processing('5'))));
    const { result } = await setup();
    await advance(121_000);
    expect(result.current.phase).toBe('timeout');
    const stopped = calls;
    await advance(30_000);
    expect(calls).toBe(stopped);

    await act(async () => {
      result.current.retry();
    });
    await advance(100);
    expect(calls).toBeGreaterThan(stopped);
    expect(result.current.phase).toBe('polling');
  });

  it('un 404 es notFound', async () => {
    server.use(http.get(`${API}/payments/pay_1`, () => apiError('PAYMENT_NOT_FOUND', 404)));
    const { result } = await setup();
    await advance(100);
    expect(result.current.phase).toBe('notFound');
  });
});
