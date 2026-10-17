import { ApiError } from '@/api/client';
import { PasskeyCancelled } from '@/features/auth/passkeys';
import { createFakePasskeys } from '../../../tests/utils/fake-passkeys';
import { buildBreakdown, buildSpokenSummary, merchantNameFrom, toConfirmationView } from './confirmation';
import { confirmErrorKind, confirmPayment } from './confirm';
import { formatCountdown } from './use-countdown';
import { quoteResponse } from '../../../tests/msw/payments';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError } from '../../../tests/msw/auth';

const copView = toConfirmationView({ ...quoteResponse('pay_1'), merchantName: 'EPM' } as never);

describe('buildBreakdown', () => {
  it('misma moneda: sin tasa, con comisión, total y lo que queda hoy', () => {
    expect(buildBreakdown(copView)).toEqual([
      { id: 'to', label: 'Le paga a', value: 'EPM' },
      { id: 'receive', label: 'Recibe', value: '$86.400' },
      { id: 'fee', label: 'Comisión TuTranqui', detail: '0.001 %', value: '$1' },
      { id: 'total', label: 'Total que sale', value: '$86.401', strong: true },
      { id: 'left', label: 'Le queda hoy', detail: 'de $500.000', value: '$413.599' },
    ]);
  });

  it('monedas distintas: agrega la tasa de cambio', () => {
    const view = toConfirmationView({
      ...quoteResponse('pay_2'),
      quote: {
        ...quoteResponse().quote,
        debitAmount: { value: '25.07', assetCode: 'USD' },
        totalDebit: { value: '25.45', assetCode: 'USD' },
        fee: { value: '0.38', assetCode: 'USD', percentage: '1.5' },
        exchangeRate: '17.152',
      },
      merchantName: 'EPM',
    } as never);
    const rows = buildBreakdown(view);
    expect(rows.find((r) => r.id === 'rate')).toEqual({
      id: 'rate',
      label: 'Tasa de cambio',
      detail: 'Vale hasta que vence el tiempo',
      value: '17.152',
    });
    expect(rows.find((r) => r.id === 'total')?.value).toBe('US$25,45');
  });

  it('sin datos del día (pago abierto desde GET /payments) omite "Le queda hoy"', () => {
    const view = toConfirmationView({
      paymentId: 'pay_3',
      type: 'p2m',
      status: 'AWAITING_CONFIRMATION',
      receiverWalletAddress: 'https://ilp.interledger-test.dev/epm',
      debitAmount: { value: '86400.00', assetCode: 'COP' },
      receiveAmount: { value: '86400.00', assetCode: 'COP' },
      totalDebit: { value: '86400.00', assetCode: 'COP' },
      description: 'EPM · número de contrato 7731',
    } as never);
    expect(buildBreakdown(view).some((r) => r.id === 'left')).toBe(false);
    expect(view.merchantName).toBe('EPM');
  });
});

describe('buildSpokenSummary', () => {
  it('con comisión, en palabras', () => {
    expect(buildSpokenSummary(copView)).toBe(
      'La factura es de ochenta y seis mil cuatrocientos pesos, más un peso de comisión. ¿Hacemos el pago?',
    );
  });

  it('sin comisión', () => {
    const view = { ...copView, fee: { value: '0.00', assetCode: 'COP' } };
    expect(buildSpokenSummary(view)).toBe('La factura es de ochenta y seis mil cuatrocientos pesos. ¿Hacemos el pago?');
  });
});

describe('merchantNameFrom', () => {
  it('toma el comercio de la descripción o, si no, el host de la wallet', () => {
    expect(merchantNameFrom('EPM · número de contrato 7731', undefined)).toBe('EPM');
    expect(merchantNameFrom(null, 'https://ilp.interledger-test.dev/epm')).toBe('ilp.interledger-test.dev/epm');
  });
});

describe('formatCountdown', () => {
  it.each([
    [300, '5:00'],
    [59, '0:59'],
    [61, '1:01'],
    [0, '0:00'],
    [-5, '0:00'],
  ])('%s s → %s', (s, text) => {
    expect(formatCountdown(s)).toBe(text);
  });
});

describe('confirmPayment', () => {
  it('opciones → passkey → confirm, en ese orden y con el challengeId', async () => {
    const order: string[] = [];
    let body: { challengeId?: string; credential?: { id: string } } = {};
    server.use(
      http.post(`${API}/payments/pay_1/confirm/options`, () => {
        order.push('options');
        return HttpResponse.json({ challengeId: 'chl_pay', challenge: 'c' });
      }),
      http.post(`${API}/payments/pay_1/confirm`, async ({ request }) => {
        order.push('confirm');
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ paymentId: 'pay_1', status: 'PROCESSING' }, { status: 202 });
      }),
    );
    const passkeys = createFakePasskeys({
      authenticate: async () => {
        order.push('passkey');
        return { id: 'cred-1' } as never;
      },
    });
    await expect(confirmPayment('pay_1', passkeys)).resolves.toEqual({ paymentId: 'pay_1', status: 'PROCESSING' });
    expect(order).toEqual(['options', 'passkey', 'confirm']);
    expect(body).toMatchObject({ challengeId: 'chl_pay', credential: { id: 'cred-1' } });
  });

  it('si cancela el passkey no llama a confirm', async () => {
    let confirmed = false;
    server.use(
      http.post(`${API}/payments/pay_1/confirm/options`, () => HttpResponse.json({ challengeId: 'c', challenge: 'x' })),
      http.post(`${API}/payments/pay_1/confirm`, () => {
        confirmed = true;
        return HttpResponse.json({}, { status: 202 });
      }),
    );
    const passkeys = createFakePasskeys({
      authenticate: async () => {
        throw new PasskeyCancelled();
      },
    });
    await expect(confirmPayment('pay_1', passkeys)).rejects.toBeInstanceOf(PasskeyCancelled);
    expect(confirmed).toBe(false);
  });

  it('deja pasar el error de la API', async () => {
    server.use(
      http.post(`${API}/payments/pay_1/confirm/options`, () => apiError('PAYMENT_NOT_CONFIRMABLE', 409)),
    );
    await expect(confirmPayment('pay_1', createFakePasskeys())).rejects.toMatchObject({
      code: 'PAYMENT_NOT_CONFIRMABLE',
    });
  });
});

describe('confirmErrorKind', () => {
  const api = (code: string) => new ApiError({ code, message: code, status: 400 });
  it.each([
    [new PasskeyCancelled(), 'cancelled'],
    [api('DAILY_LIMIT_EXCEEDED'), 'daily-limit'],
    [api('QUOTE_EXPIRED'), 'expired'],
    [api('CHALLENGE_EXPIRED'), 'retry'],
    [api('PASSKEY_VERIFICATION_FAILED'), 'retry'],
    [api('WALLET_NOT_LINKED'), 'relink'],
    [api('WALLET_LINK_REVOKED'), 'relink'],
    [api('PAYMENT_NOT_CONFIRMABLE'), 'not-confirmable'],
    [api('OTRO'), 'unknown'],
    [new Error('x'), 'unknown'],
  ])('%s → %s', (error, kind) => {
    expect(confirmErrorKind(error)).toBe(kind);
  });
});
