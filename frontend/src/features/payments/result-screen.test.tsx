import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, screen } from 'expo-router/testing-library';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError, fixtures } from '../../../tests/msw/auth';
import { makePayment } from '../../../tests/msw/transactions';
import { renderApp } from '../../../tests/utils/render-app';
import type { PaymentDetail } from '@/features/transactions/types';
import type { Session } from '@/features/auth/types';

const session: Session = { ...fixtures.session, user: fixtures.user };
const open = () => renderApp({ initialUrl: '/pagos/resultado/pay_1', session });
const serve = (p: Partial<PaymentDetail>, headers?: Record<string, string>) =>
  server.use(
    http.get(`${API}/payments/pay_1`, () =>
      HttpResponse.json(makePayment({ paymentId: 'pay_1', description: 'EPM · número de contrato 7731', ...p }), { headers }),
    ),
  );

describe('Resultado del pago', () => {
  it('PROCESSING → COMPLETED: muestra el comprobante con hora, comisión, total y disponible, y lo anuncia', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    let calls = 0;
    server.use(
      http.get(`${API}/payments/pay_1`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              makePayment({ paymentId: 'pay_1', status: 'PROCESSING', isFinal: false, description: 'EPM · número de contrato 7731' }),
              { headers: { 'Retry-After': '1' } },
            )
          : HttpResponse.json(
              makePayment({
                paymentId: 'pay_1',
                status: 'COMPLETED',
                isFinal: true,
                description: 'EPM · número de contrato 7731',
                updatedAt: '2026-10-17T20:24:00Z',
              }),
            );
      }),
    );
    await open();
    expect(await screen.findByText('Enviando el pago…')).toBeTruthy();
    expect(screen.getByText('Esto toma unos segundos.')).toBeTruthy();
    expect(await screen.findByText('Listo. Su pago quedó hecho.', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('EPM lo recibió a las 3:24 p. m..')).toBeTruthy();
    expect(screen.getByText('Comisión TuTranqui')).toBeTruthy();
    expect(screen.getByText('$86.401')).toBeTruthy();
    expect(await screen.findByText('$454.500')).toBeTruthy(); // le queda hoy
    expect(screen.getByText('pay_1')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('Listo. Su pago quedó hecho.');
    announce.mockRestore();
  });

  it.each([
    ['FAILED sin envío', { status: 'FAILED', sentAmount: { value: '0.00', assetCode: 'COP' }, error: { code: 'WALLET_LINK_REVOKED', message: 'x' } }, 'El pago no se pudo hacer', /El permiso en su wallet ya no está activo\. No se debitó nada\./],
    ['FAILED con envío parcial', { status: 'FAILED', sentAmount: { value: '50000.00', assetCode: 'COP' }, error: { code: 'OTRO', message: 'x' } }, 'El pago no se pudo hacer', /Se debitaron \$50\.000 de su wallet/],
    ['CANCELLED', { status: 'CANCELLED' }, 'Usted canceló el pago', /No se movió ni un peso\./],
    ['EXPIRED', { status: 'EXPIRED' }, 'Se venció el tiempo para confirmar', /No se movió ni un peso\. Puede prepararlo otra vez\./],
  ])('%s', async (_name, payment, title, detail) => {
    serve({ ...(payment as Partial<PaymentDetail>), isFinal: true });
    await open();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preparar el pago otra vez' })).toBeTruthy();
  });

  it('las acciones llevan al directorio y a la lista de transacciones', async () => {
    serve({ status: 'COMPLETED', isFinal: true });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Pagar algo más' }));
    expect(await screen.findByText('¿Qué servicio quiere pagar?')).toBeTruthy();
  });

  it('"Ver mis transacciones" abre la lista', async () => {
    serve({ status: 'COMPLETED', isFinal: true });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Ver mis transacciones' }));
    expect(await screen.findByText('Mis pagos')).toBeTruthy();
  });

  it('sin estado final en 2 minutos deja de consultar y ofrece consultar de nuevo', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/payments/pay_1`, () => {
        calls += 1;
        return HttpResponse.json(makePayment({ paymentId: 'pay_1', status: 'PROCESSING', isFinal: false }), {
          headers: { 'Retry-After': '5' },
        });
      }),
    );
    await open();
    await screen.findByText('Enviando el pago…');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(125_000);
    });
    expect(
      await screen.findByText('El pago sigue en proceso. Lo puede revisar en sus transacciones'),
    ).toBeTruthy();
    const stopped = calls;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(calls).toBe(stopped);
    await fireEvent.press(screen.getByRole('button', { name: 'Consultar de nuevo' }));
    expect(await screen.findByText('Enviando el pago…')).toBeTruthy();
  });

  it('un pago inexistente o ajeno (404) muestra "No encontramos ese pago"', async () => {
    server.use(http.get(`${API}/payments/pay_1`, () => apiError('PAYMENT_NOT_FOUND', 404)));
    await open();
    expect(await screen.findByText('No encontramos ese pago')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ir al inicio' }));
    expect(await screen.findByText(/¿Qué pagamos hoy\?/)).toBeTruthy();
  });
});
