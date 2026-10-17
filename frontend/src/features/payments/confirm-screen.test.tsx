import { AccessibilityInfo, Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError, fixtures } from '../../../tests/msw/auth';
import { makePayment } from '../../../tests/msw/transactions';
import { quoteResponse } from '../../../tests/msw/payments';
import { createFakePasskeys } from '../../../tests/utils/fake-passkeys';
import { renderApp } from '../../../tests/utils/render-app';
import { PasskeyCancelled } from '@/features/auth/passkeys';
import type { Session } from '@/features/auth/types';
import { paymentQuoteKey } from './api';

const session: Session = { ...fixtures.session, user: fixtures.user };
const screens = {
  '(app)/pagos/resultado/[paymentId]': () => <Text>Pantalla de resultado</Text>,
  '(app)/vincular/index': () => <Text>Pantalla de vincular</Text>,
};

const quote = (overrides: Record<string, unknown> = {}) => ({
  ...quoteResponse('pay_1'),
  confirmBy: new Date(Date.now() + 5 * 60_000).toISOString(),
  merchantName: 'EPM',
  ...overrides,
});

const open = (data: unknown = quote(), passkeys?: ReturnType<typeof createFakePasskeys>) =>
  renderApp({
    initialUrl: '/pagos/confirmar/pay_1',
    session,
    screens,
    passkeys,
    seed: (qc) => qc.setQueryData(paymentQuoteKey('pay_1'), data),
  });

describe('Confirmación del pago', () => {
  it('muestra comercio, recibe, comisión, total y lo que queda hoy desde la caché', async () => {
    let fetched = false;
    server.use(http.get(`${API}/payments/pay_1`, () => ((fetched = true), HttpResponse.json(makePayment()))));
    await open();
    expect(await screen.findByText('Revise su pago')).toBeTruthy();
    expect(screen.getByText('EPM')).toBeTruthy();
    expect(screen.getByText('$86.400')).toBeTruthy();
    expect(screen.getByText('$86.401')).toBeTruthy();
    expect(screen.getByText('$413.599')).toBeTruthy();
    expect(screen.getByText(/La factura es de ochenta y seis mil cuatrocientos pesos, más un peso de comisión/)).toBeTruthy();
    expect(fetched).toBe(false);
  });

  it('sin caché pide GET /payments/{id}', async () => {
    server.use(
      http.get(`${API}/payments/pay_1`, () =>
        HttpResponse.json(
          makePayment({ paymentId: 'pay_1', status: 'AWAITING_CONFIRMATION', isFinal: false, description: 'EPM · número de contrato 7731' }),
        ),
      ),
    );
    await renderApp({ initialUrl: '/pagos/confirmar/pay_1', session, screens });
    expect(await screen.findByText('Revise su pago')).toBeTruthy();
    expect(screen.getByText('EPM')).toBeTruthy();
  });

  it('anuncia el resumen al entrar y de nuevo con "Repítamelo"', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    spy.mockClear();
    await open();
    await screen.findByText('Revise su pago');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const before = spy.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Repítamelo' }));
    expect(spy).toHaveBeenCalledTimes(before + 1);
    expect(spy.mock.calls[before][0]).toMatch(/¿Hacemos el pago\?$/);
    spy.mockRestore();
  });

  it('"Sí, pagar": opciones → passkey → confirm y va al resultado', async () => {
    const passkeys = createFakePasskeys();
    await open(quote(), passkeys);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, pagar' }));
    expect(await screen.findByText('Pantalla de resultado')).toBeTruthy();
    expect(passkeys.calls.authenticate).toHaveLength(1);
  });

  it('cancelar el diálogo del passkey deja el pago sin hacer', async () => {
    let confirmed = false;
    server.use(
      http.post(`${API}/payments/pay_1/confirm`, () => ((confirmed = true), HttpResponse.json({}, { status: 202 }))),
    );
    await open(
      quote(),
      createFakePasskeys({
        authenticate: async () => {
          throw new PasskeyCancelled();
        },
      }),
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, pagar' }));
    expect(await screen.findByText('No se confirmó el pago. No se movió ni un peso.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sí, pagar' })).toBeTruthy();
    expect(confirmed).toBe(false);
  });

  it('DAILY_LIMIT_EXCEEDED avisa y muestra cuánto le queda hoy', async () => {
    server.use(http.post(`${API}/payments/pay_1/confirm`, () => apiError('DAILY_LIMIT_EXCEEDED', 422)));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, pagar' }));
    expect(await screen.findByText(/Este pago pasa su monto de hoy\. Hoy le quedan \$454\.500\./)).toBeTruthy();
  });

  it('QUOTE_EXPIRED pide preparar el pago otra vez', async () => {
    server.use(http.post(`${API}/payments/pay_1/confirm`, () => apiError('QUOTE_EXPIRED', 410)));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, pagar' }));
    expect(await screen.findByText('Se venció el tiempo. Prepare el pago otra vez')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sí, pagar' })).toBeNull();
  });

  it.each(['CHALLENGE_EXPIRED', 'PASSKEY_VERIFICATION_FAILED'])('%s permite reintentar', async (code) => {
    let calls = 0;
    server.use(
      http.post(`${API}/payments/pay_1/confirm`, () => {
        calls += 1;
        return calls === 1 ? apiError(code, 400) : HttpResponse.json({ paymentId: 'pay_1', status: 'PROCESSING' }, { status: 202 });
      }),
    );
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, pagar' }));
    expect(await screen.findByText('No pudimos comprobar su passkey. Intente de nuevo.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sí, pagar' }));
    expect(await screen.findByText('Pantalla de resultado')).toBeTruthy();
  });

  it.each(['WALLET_NOT_LINKED', 'WALLET_LINK_REVOKED'])('%s lleva a vincular otra vez', async (code) => {
    server.use(http.post(`${API}/payments/pay_1/confirm`, () => apiError(code, 403)));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, pagar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Vincular mi wallet' }));
    expect(await screen.findByText('Pantalla de vincular')).toBeTruthy();
  });

  it('PAYMENT_NOT_CONFIRMABLE redirige al resultado', async () => {
    server.use(http.post(`${API}/payments/pay_1/confirm`, () => apiError('PAYMENT_NOT_CONFIRMABLE', 409)));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, pagar' }));
    expect(await screen.findByText('Pantalla de resultado')).toBeTruthy();
  });

  it('un pago que ya no espera confirmación redirige al resultado', async () => {
    await open(quote({ status: 'PROCESSING' }));
    expect(await screen.findByText('Pantalla de resultado')).toBeTruthy();
  });

  it('la cuenta regresiva llega a 0 y deshabilita la confirmación', async () => {
    await open(quote({ confirmBy: new Date(Date.now() + 3000).toISOString() }));
    expect(await screen.findByText(/Tiene 0:0[0-3] para confirmar/)).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });
    expect(await screen.findByText('Se venció el tiempo. Prepare el pago otra vez')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sí, pagar' })).toBeNull();
  });

  it('"No pagar" cancela el pago y vuelve al inicio', async () => {
    let cancelled = false;
    server.use(http.post(`${API}/payments/pay_1/cancel`, () => ((cancelled = true), new HttpResponse(null, { status: 204 }))));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'No pagar' }));
    expect(await screen.findByText(/¿Qué pagamos hoy\?/)).toBeTruthy();
    expect(cancelled).toBe(true);
  });
});
