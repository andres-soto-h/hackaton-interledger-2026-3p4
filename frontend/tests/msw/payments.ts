import { http, HttpResponse } from 'msw';
import { API } from './config';

export const quoteResponse = (paymentId = 'pay_new1') => ({
  paymentId,
  status: 'AWAITING_CONFIRMATION',
  confirmBy: '2099-01-01T00:05:00.000Z',
  quote: {
    debitAmount: { value: '86400.00', assetCode: 'COP' },
    receiveAmount: { value: '86400.00', assetCode: 'COP' },
    fee: { value: '1.00', assetCode: 'COP', percentage: '0.001' },
    totalDebit: { value: '86401.00', assetCode: 'COP' },
  },
  allowance: {
    dailyLimit: { value: '500000.00', assetCode: 'COP' },
    availableAfter: { value: '413599.00', assetCode: 'COP' },
  },
});

export const paymentHandlers = [
  http.get(`${API}/wallets/verify`, ({ request }) => {
    const wallet = new URL(request.url).searchParams.get('walletAddress') ?? '';
    const name = wallet.endsWith('/epm') ? 'EPM' : wallet.endsWith('/claro') ? 'Claro' : 'Otro';
    return HttpResponse.json({ exists: true, publicName: name, assetCode: 'COP', assetScale: 2 });
  }),
  http.post(`${API}/payments`, () => HttpResponse.json(quoteResponse(), { status: 201 })),
];
