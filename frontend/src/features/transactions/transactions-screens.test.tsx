import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError, fixtures } from '../../../tests/msw/auth';
import { makePayment, makeTransaction, transactionsHandler } from '../../../tests/msw/transactions';
import { renderApp } from '../../../tests/utils/render-app';
import type { Session } from '@/features/auth/types';

const session: Session = { ...fixtures.session, user: fixtures.user };
const many = (n: number) => Array.from({ length: n }, (_, i) => makeTransaction(i + 1));

describe('Inicio', () => {
  it('saluda por el nombre y muestra las 5 transacciones más recientes', async () => {
    const seen: URL[] = [];
    server.use(transactionsHandler(many(8), seen));
    await renderApp({ initialUrl: '/', session });
    expect(await screen.findByText('Hola, Claudia. ¿Qué pagamos hoy?')).toBeTruthy();
    expect(await screen.findByText('Comercio 5')).toBeTruthy();
    expect(screen.queryByText('Comercio 6')).toBeNull();
    expect(seen[0].searchParams.get('limit')).toBe('5');
    await fireEvent.press(screen.getByRole('button', { name: 'Ver todas' }));
    expect(await screen.findByText('Mis pagos')).toBeTruthy();
  });

  it('sin transacciones muestra el estado vacío y "Pagar un servicio"', async () => {
    server.use(transactionsHandler([]));
    await renderApp({ initialUrl: '/', session });
    expect(await screen.findByText('Todavía no ha hecho pagos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pagar un servicio' })).toBeTruthy();
  });

  it('un error 500 muestra el error y "Reintentar" recupera los datos', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/transactions`, () =>
        fail ? apiError('INTERNAL_ERROR', 500) : HttpResponse.json({ items: [makeTransaction(1)], nextCursor: null }),
      ),
    );
    await renderApp({ initialUrl: '/', session });
    expect(await screen.findByText('No pudimos cargar sus pagos.')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Comercio 1')).toBeTruthy();
  });
});

describe('Lista de transacciones', () => {
  it('sin transacciones muestra el estado vacío', async () => {
    server.use(transactionsHandler([]));
    await renderApp({ initialUrl: '/transacciones', session });
    expect(await screen.findByText('Todavía no ha hecho pagos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pagar un servicio' })).toBeTruthy();
  });

  it('carga la segunda página al llegar al final, sin duplicados', async () => {
    const seen: URL[] = [];
    server.use(transactionsHandler(many(25), seen));
    const app = await renderApp({ initialUrl: '/transacciones', session });
    await screen.findByText('Comercio 1');
    expect(seen).toHaveLength(1);
    expect(seen[0].searchParams.get('cursor')).toBeNull();

    const list = screen.getByTestId('transaction-list');
    await act(async () => {
      list.props.onEndReached();
    });
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1].searchParams.get('cursor')).toBe('20');
    await waitFor(() => {
      const cached = app.queryClient.getQueryData<{ pages: { items: { id: string }[] }[] }>([
        'transactions',
        { status: undefined, limit: 20 },
      ]);
      const ids = cached?.pages.flatMap((p) => p.items.map((t) => t.id)) ?? [];
      expect(ids).toHaveLength(25);
      expect(new Set(ids).size).toBe(25); // sin duplicados
    });
  });

  it('cambiar el filtro pide status y reinicia la lista', async () => {
    const seen: URL[] = [];
    const data = [makeTransaction(1), makeTransaction(2, { status: 'FAILED' })];
    server.use(transactionsHandler(data, seen));
    await renderApp({ initialUrl: '/transacciones', session });
    await screen.findByText('Comercio 2');
    await fireEvent.press(screen.getByRole('radio', { name: 'Fallidas' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('status')).toBe('FAILED'));
    expect(await screen.findByText('Comercio 2')).toBeTruthy();
    expect(screen.queryByText('Comercio 1')).toBeNull();
  });

  it('pull to refresh vuelve a pedir la primera página', async () => {
    const seen: URL[] = [];
    server.use(transactionsHandler(many(3), seen));
    await renderApp({ initialUrl: '/transacciones', session });
    await screen.findByText('Comercio 1');
    const list = screen.getByTestId('transaction-list');
    await act(async () => {
      list.props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1].searchParams.get('cursor')).toBeNull();
  });
});

describe('Detalle de la transacción', () => {
  it('muestra comercio, montos, estado y comprobante', async () => {
    server.use(
      transactionsHandler([makeTransaction(1, { counterparty: { name: 'EPM', walletAddress: 'https://w.test/epm' } })]),
      http.get(`${API}/payments/pay_001`, () => HttpResponse.json(makePayment({ paymentId: 'pay_001' }))),
    );
    await renderApp({ initialUrl: '/', session });
    await fireEvent.press(await screen.findByRole('button', { name: /^EPM,/ }));
    expect(await screen.findByText('Detalle del pago')).toBeTruthy();
    expect(await screen.findByText('Comisión TuTranqui')).toBeTruthy();
    expect(screen.getAllByText('EPM').length).toBeGreaterThan(0);
    expect(screen.getByText('$86.400')).toBeTruthy();
    expect(screen.getByText('pay_001')).toBeTruthy();
    expect(screen.getByText('Pago exitoso')).toBeTruthy();
  });

  it('un pago PROCESSING se actualiza solo y deja de consultar al ser final', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/payments/pay_009`, () => {
        calls += 1;
        return calls < 2
          ? HttpResponse.json(makePayment({ paymentId: 'pay_009', status: 'PROCESSING', isFinal: false }), {
              headers: { 'Retry-After': '1' },
            })
          : HttpResponse.json(makePayment({ paymentId: 'pay_009', status: 'COMPLETED', isFinal: true }));
      }),
    );
    await renderApp({ initialUrl: '/transacciones/pay_009', session });
    expect(await screen.findByText('Enviando el pago…')).toBeTruthy();
    expect(await screen.findByText('Pago exitoso', undefined, { timeout: 4000 })).toBeTruthy();
    const settled = calls;
    // expo-router/testing-library usa timers falsos: se avanza el reloj en vez de esperar.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(calls).toBe(settled);
  });

  it('un error muestra "Reintentar"', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/payments/pay_404`, () =>
        fail ? apiError('PAYMENT_NOT_FOUND', 404) : HttpResponse.json(makePayment({ paymentId: 'pay_404' })),
      ),
    );
    await renderApp({ initialUrl: '/transacciones/pay_404', session });
    expect(await screen.findByText('No pudimos cargar este pago.')).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('pay_404')).toBeTruthy();
  });
});
