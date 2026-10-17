import type { Amount } from '@/lib/money';
import type { PaymentStatus } from '@/ui';

export type Fee = Amount & { percentage?: string };

export type Counterparty = { name: string | null; walletAddress: string; merchantId?: string };

export type Transaction = {
  id: string;
  kind: 'payment' | 'payment-request';
  direction: 'incoming' | 'outgoing';
  type: 'p2p' | 'p2m';
  status: PaymentStatus;
  counterparty: Counterparty;
  debitAmount: Amount;
  receiveAmount: Amount;
  fee?: Fee;
  totalDebit?: Amount;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TransactionsPage = { items: Transaction[]; nextCursor: string | null };

/** Respuesta de `GET /payments/{id}` (backend 008). */
export type PaymentDetail = {
  paymentId: string;
  type: 'p2p' | 'p2m';
  status: PaymentStatus;
  isFinal?: boolean;
  senderWalletAddress: string;
  receiverWalletAddress: string;
  debitAmount: Amount;
  receiveAmount: Amount;
  sentAmount?: Amount | null;
  fee?: Fee;
  feeStatus?: string;
  totalDebit?: Amount;
  description?: string | null;
  error?: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
};
