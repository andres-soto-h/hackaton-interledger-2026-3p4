import { apiClient } from '@/api/client';
import type { PaymentStatus } from '@/ui';
import type { PaymentDetail, TransactionsPage } from './types';

export type TransactionsQuery = { status?: PaymentStatus; limit?: number; cursor?: string | null };

export const transactionsApi = {
  list: ({ status, limit = 20, cursor }: TransactionsQuery = {}) =>
    apiClient.get<TransactionsPage>('/transactions', {
      query: { direction: 'outgoing', kind: 'payment', status, limit, cursor },
    }),
  getPayment: async (paymentId: string) => {
    const { data, retryAfterSeconds } = await apiClient.getWithHeaders<PaymentDetail>(
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    return { payment: data, retryAfterSeconds };
  },
};
