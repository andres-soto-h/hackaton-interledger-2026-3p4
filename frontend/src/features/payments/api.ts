import { apiClient } from '@/api/client';
import type { Amount } from '@/lib/money';

export type PaymentQuote = {
  paymentId: string;
  status: 'AWAITING_CONFIRMATION';
  confirmBy: string;
  quote: {
    debitAmount: Amount;
    receiveAmount: Amount;
    exchangeRate?: string;
    fee: Amount & { percentage?: string };
    totalDebit: Amount;
  };
  allowance: { dailyLimit: Amount; availableAfter: Amount };
};

export type CreateMerchantPayment = {
  receiverWalletAddress: string;
  amount: Amount;
  description: string;
};

export const paymentsApi = {
  /** Pago a un comercio: `p2m` con la wallet del comercio y el monto en COP (backend 026). */
  createMerchantPayment: (body: CreateMerchantPayment, idempotencyKey: string) =>
    apiClient.post<PaymentQuote>('/payments', { type: 'p2m', ...body }, { idempotencyKey }),
};

/** Clave de caché donde se deja el pago creado para que la confirmación (spec 006) lo muestre. */
export const paymentQuoteKey = (paymentId: string) => ['payment-quote', paymentId] as const;
