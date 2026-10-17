import { Text } from 'react-native';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError, fixtures } from '../../../tests/msw/auth';
import { quoteResponse } from '../../../tests/msw/payments';
import { renderApp } from '../../../tests/utils/render-app';
import { paymentQuoteKey } from './api';
import type { Session } from '@/features/auth/types';

const session: Session = { ...fixtures.session, user: fixtures.user };
const ConfirmStub = () => <Text>Pantalla de confirmación</Text>;
// Los pasos de la validación se revelan de a uno (350 ms c/u): se espera más que el valor por omisión.
const SLOW = { timeout: 6000 };
const screens = { '(app)/pagos/confirmar/[paymentId]': ConfirmStub };

async function openEpmForm() {
  const app = await renderApp({ initialUrl: '/pagos', session, screens });
  await fireEvent.press(await screen.findByRole('button', { name: /^EPM,/ }));
  return app;
}

async function fillAndContinue(reference = '7731', amount = '86400') {
  await fireEvent.changeText(await screen.findByLabelText('Número de contrato'), reference);
  await fireEvent.changeText(screen.getByLabelText('Valor de la factura'), amount);
  await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
}

describe('Directorio', () => {
  it('busca sin distinguir mayúsculas ni tildes', async () => {
    await renderApp({ initialUrl: '/pagos', session, screens });
    expect(await screen.findByRole('button', { name: /^Claro,/ })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Buscar por nombre'), 'Épm');
    expect(screen.getByRole('button', { name: /^EPM,/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Claro,/ })).toBeNull();
  });

  it('filtra por categoría y avisa si no hay resultados', async () => {
    await renderApp({ initialUrl: '/pagos', session, screens });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Celular' }));
    expect(screen.getByRole('button', { name: /^Claro,/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^EPM,/ })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Buscar por nombre'), 'zzz');
    expect(screen.getByText('No encontramos ese servicio')).toBeTruthy();
  });
});

describe('Datos del pago', () => {
  it('muestra la etiqueta de referencia del comercio', async () => {
    await openEpmForm();
    expect(await screen.findByLabelText('Número de contrato')).toBeTruthy();
    expect(screen.getByText(/En pesos colombianos/)).toBeTruthy();
  });

  it.each(['0', '-5', 'abc', '1e3', '10,123'])('valor inválido %j muestra el error y no navega', async (amount) => {
    await openEpmForm();
    await fillAndContinue('7731', amount);
    await waitFor(() => expect(screen.queryByLabelText('Valor de la factura')).toBeTruthy());
    expect(screen.queryByText(/Revisando la cuenta de EPM/)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('referencia vacía muestra el error del campo', async () => {
    await openEpmForm();
    await fillAndContinue('', '86400');
    expect(await screen.findByText('Escriba su número de contrato')).toBeTruthy();
  });
});

describe('Validación y creación del pago', () => {
  it('valida el comercio y crea el pago p2m en COP con Idempotency-Key; navega a la confirmación', async () => {
    let body: Record<string, unknown> = {};
    let key: string | null = null;
    server.use(
      http.post(`${API}/payments`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        key = request.headers.get('idempotency-key');
        return HttpResponse.json(quoteResponse('pay_abc'), { status: 201 });
      }),
    );
    const app = await openEpmForm();
    await fillAndContinue('7731', '86.400');

    expect(await screen.findByText('Listo, ya revisé. La cuenta de EPM es la correcta', undefined, SLOW)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir con el pago' }));

    expect(await screen.findByText('Pantalla de confirmación')).toBeTruthy();
    expect(body).toEqual({
      type: 'p2m',
      receiverWalletAddress: 'https://ilp.interledger-test.dev/epm',
      amount: { value: '86400.00', assetCode: 'COP' },
      description: 'EPM · número de contrato 7731',
    });
    expect(key).toMatch(/[0-9a-f-]{8,}/);
    expect(app.queryClient.getQueryData<{ paymentId: string }>(paymentQuoteKey('pay_abc'))?.paymentId).toBe('pay_abc');
  });

  it('una wallet que no existe muestra el error y no permite seguir ni crea el pago', async () => {
    let created = false;
    server.use(
      http.get(`${API}/wallets/verify`, () => HttpResponse.json({ exists: false, publicName: null })),
      http.post(`${API}/payments`, () => {
        created = true;
        return HttpResponse.json(quoteResponse(), { status: 201 });
      }),
    );
    await openEpmForm();
    await fillAndContinue();
    expect(
      await screen.findByText('No pudimos comprobar la cuenta de EPM. No se ha movido ni un peso', undefined, SLOW),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seguir con el pago' })).toBeNull();
    expect(created).toBe(false);
  });

  it('un nombre distinto es solo una advertencia y deja seguir', async () => {
    server.use(
      http.get(`${API}/wallets/verify`, () =>
        HttpResponse.json({ exists: true, publicName: 'Otra Empresa', assetCode: 'COP', assetScale: 2 }),
      ),
    );
    await openEpmForm();
    await fillAndContinue();
    expect(await screen.findByText('La wallet dice ser de Otra Empresa', undefined, SLOW)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Seguir con el pago' }, SLOW)).toBeTruthy();
  });

  it('QUOTE_FAILED muestra un mensaje y el reintento usa la misma Idempotency-Key', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post(`${API}/payments`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return keys.length === 1 ? apiError('QUOTE_FAILED', 422) : HttpResponse.json(quoteResponse(), { status: 201 });
      }),
    );
    await openEpmForm();
    await fillAndContinue();
    await fireEvent.press(await screen.findByRole('button', { name: 'Seguir con el pago' }, SLOW));
    expect(await screen.findByText(/No pudimos calcular el pago/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir con el pago' }));
    expect(await screen.findByText('Pantalla de confirmación')).toBeTruthy();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('un error desconocido muestra el mensaje genérico con el requestId', async () => {
    server.use(http.post(`${API}/payments`, () => apiError('RARO', 500)));
    await openEpmForm();
    await fillAndContinue();
    await fireEvent.press(await screen.findByRole('button', { name: 'Seguir con el pago' }, SLOW));
    expect(await screen.findByText('No pudimos preparar el pago. Intente de nuevo')).toBeTruthy();
    expect(screen.getByText('Código para soporte: req_test')).toBeTruthy();
  });

  it('"Parar" vuelve al inicio sin crear el pago', async () => {
    let created = false;
    server.use(
      http.post(`${API}/payments`, () => {
        created = true;
        return HttpResponse.json(quoteResponse(), { status: 201 });
      }),
    );
    await openEpmForm();
    await fillAndContinue();
    await screen.findByText(/Listo, ya revisé/, undefined, SLOW);
    await fireEvent.press(screen.getByRole('button', { name: 'Parar' }));
    expect(await screen.findByText(/¿Qué pagamos hoy\?/)).toBeTruthy();
    expect(created).toBe(false);
  });
});
