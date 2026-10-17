import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PaymentStatus } from '@/ui';
import { transactionsApi } from './api';

export const transactionKeys = {
  list: (status?: PaymentStatus, limit?: number) => ['transactions', { status, limit }] as const,
  payment: (id: string) => ['payments', id] as const,
};

export function useTransactions({ status, limit = 20 }: { status?: PaymentStatus; limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: transactionKeys.list(status, limit),
    queryFn: ({ pageParam }) => transactionsApi.list({ status, limit, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const useRecentTransactions = () => useTransactions({ limit: 5 });

const DEFAULT_POLL_MS = 2000;

/** Pago por id; mientras no sea final consulta de nuevo según `Retry-After` (backend 009). */
export function usePayment(paymentId: string) {
  return useQuery({
    queryKey: transactionKeys.payment(paymentId),
    queryFn: () => transactionsApi.getPayment(paymentId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const isFinal =
        data.payment.isFinal ??
        ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(data.payment.status);
      if (isFinal) return false;
      return data.retryAfterSeconds ? data.retryAfterSeconds * 1000 : DEFAULT_POLL_MS;
    },
  });
}
