import { http, HttpResponse } from 'msw';
import { API } from './config';
import type { PaymentDetail, Transaction } from '@/features/transactions/types';

export function makeTransaction(n: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `pay_${String(n).padStart(3, '0')}`,
    kind: 'payment',
    direction: 'outgoing',
    type: 'p2m',
    status: 'COMPLETED',
    counterparty: { name: `Comercio ${n}`, walletAddress: `https://ilp.interledger-test.dev/c${n}` },
    debitAmount: { value: '86400.00', assetCode: 'COP' },
    receiveAmount: { value: '86400.00', assetCode: 'COP' },
    fee: { value: '1.00', assetCode: 'COP', percentage: '0.001' },
    totalDebit: { value: '86401.00', assetCode: 'COP' },
    description: `Factura ${n}`,
    createdAt: new Date(Date.now() - n * 3600_000).toISOString(),
    updatedAt: new Date(Date.now() - n * 3600_000).toISOString(),
    ...overrides,
  };
}

export function makePayment(overrides: Partial<PaymentDetail> = {}): PaymentDetail {
  return {
    paymentId: 'pay_001',
    type: 'p2m',
    status: 'COMPLETED',
    isFinal: true,
    senderWalletAddress: 'https://ilp.interledger-test.dev/claudia',
    receiverWalletAddress: 'https://ilp.interledger-test.dev/epm',
    debitAmount: { value: '86400.00', assetCode: 'COP' },
    receiveAmount: { value: '86400.00', assetCode: 'COP' },
    fee: { value: '1.00', assetCode: 'COP', percentage: '0.001' },
    totalDebit: { value: '86401.00', assetCode: 'COP' },
    description: 'EPM · contrato 7731',
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Handler paginado: `cursor` es el índice del siguiente elemento; respeta `status` y `limit`. */
export function transactionsHandler(all: Transaction[], seen?: URL[]) {
  return http.get(`${API}/transactions`, ({ request }) => {
    const url = new URL(request.url);
    seen?.push(url);
    const status = url.searchParams.get('status');
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const start = Number(url.searchParams.get('cursor') ?? 0);
    const filtered = status ? all.filter((t) => t.status === status) : all;
    const items = filtered.slice(start, start + limit);
    const next = start + limit < filtered.length ? String(start + limit) : null;
    return HttpResponse.json({ items, nextCursor: next });
  });
}

export const transactionHandlers = [
  transactionsHandler([makeTransaction(1), makeTransaction(2, { status: 'PROCESSING' })]),
  http.get(`${API}/payments/:id`, ({ params }) =>
    HttpResponse.json(makePayment({ paymentId: String(params.id) })),
  ),
];
