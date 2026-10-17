import { Platform } from 'react-native';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError, fixtures } from '../../../tests/msw/auth';
import { createFakePasskeys } from '../../../tests/utils/fake-passkeys';
import { renderApp } from '../../../tests/utils/render-app';
import { openExternalUrl } from '@/lib/open-url';
import { PasskeyCancelled } from './passkeys';
import type { Session } from './types';

jest.mock('@/lib/open-url', () => ({
  ...jest.requireActual('@/lib/open-url'),
  openExternalUrl: jest.fn(),
}));

const session: Session = { ...fixtures.session, user: fixtures.user };
const openUrl = openExternalUrl as jest.Mock;
beforeEach(() => openUrl.mockClear());

async function fillStep1(name = 'Claudia Pérez', wallet = '$ilp.interledger-test.dev/claudia') {
  await fireEvent.changeText(await screen.findByLabelText('Su nombre'), name);
  await fireEvent.changeText(screen.getByLabelText('Dirección de su wallet'), wallet);
  await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
}

describe('Registro · paso 1 (datos)', () => {
  it('con el formulario vacío muestra el error de cada campo y no llama a la API', async () => {
    let called = false;
    server.use(
      http.post(`${API}/auth/register/options`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    await renderApp({ initialUrl: '/registro' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Seguir' }));
    expect(await screen.findByText('Escriba su nombre')).toBeTruthy();
    expect(screen.getByText(/Escriba la dirección de su wallet/)).toBeTruthy();
    expect(called).toBe(false);
  });

  it('normaliza el payment pointer antes de enviarlo', async () => {
    let body: { displayName?: string; walletAddress?: string } = {};
    server.use(
      http.post(`${API}/auth/register/options`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ challengeId: 'chl_register', challenge: 'xyz' });
      }),
    );
    await renderApp({ initialUrl: '/registro' });
    await fillStep1('  Claudia  ');
    expect(await screen.findByRole('button', { name: 'Crear mi passkey' })).toBeTruthy();
    expect(body).toEqual({
      displayName: 'Claudia',
      walletAddress: 'https://ilp.interledger-test.dev/claudia',
    });
  });

  it.each(['WALLET_NOT_FOUND', 'WALLET_NOT_ALLOWED'])(
    '%s se muestra en el campo de la wallet y no se pide el passkey',
    async (code) => {
      server.use(http.post(`${API}/auth/register/options`, () => apiError(code, 422)));
      const app = await renderApp({ initialUrl: '/registro' });
      await fillStep1();
      expect(await screen.findByText(/No encontramos esa wallet|no está permitida/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Crear mi passkey' })).toBeNull();
      expect(app.passkeys.calls.create).toHaveLength(0);
    },
  );

  it('una wallet que ya tiene cuenta muestra el error y un enlace a Ingresar', async () => {
    server.use(http.post(`${API}/auth/register/options`, () => apiError('WALLET_ALREADY_REGISTERED', 409)));
    await renderApp({ initialUrl: '/registro' });
    await fillStep1();
    expect(await screen.findByText(/Esa wallet ya tiene una cuenta/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('button', { name: 'Ingresar con mi passkey' })).toBeTruthy();
  });

  it('un doble toque en Seguir hace una sola petición', async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/auth/register/options`, () => {
        calls += 1;
        return HttpResponse.json({ challengeId: 'chl_register', challenge: 'xyz' });
      }),
    );
    await renderApp({ initialUrl: '/registro' });
    await fireEvent.changeText(await screen.findByLabelText('Su nombre'), 'Claudia');
    await fireEvent.changeText(screen.getByLabelText('Dirección de su wallet'), '$ilp.interledger-test.dev/c');
    const seguir = screen.getByRole('button', { name: 'Seguir' });
    await fireEvent.press(seguir);
    await fireEvent.press(seguir);
    await screen.findByRole('button', { name: 'Crear mi passkey' });
    expect(calls).toBe(1);
  });
});

describe('Registro · paso 2 (passkey)', () => {
  it('crea el passkey, verifica con el challengeId y sigue al paso 3 con sesión', async () => {
    let verify: { challengeId?: string; credential?: { id: string } } = {};
    server.use(
      http.post(`${API}/auth/register/verify`, async ({ request }) => {
        verify = (await request.json()) as typeof verify;
        return HttpResponse.json({ user: fixtures.user, session: fixtures.session }, { status: 201 });
      }),
    );
    const app = await renderApp({ initialUrl: '/registro' });
    await fillStep1();
    await fireEvent.press(await screen.findByRole('button', { name: 'Crear mi passkey' }));
    expect(await screen.findByText(/Cada pago lo confirma usted en la app/)).toBeTruthy();
    expect(verify.challengeId).toBe('chl_register');
    expect(verify.credential?.id).toBe('cred-new');
    expect(app.passkeys.calls.create).toHaveLength(1);
    expect((await app.store.load())?.token).toBe('tok_login');
  });

  it('si cancela el diálogo, sigue en el paso 2 y puede reintentar', async () => {
    let attempts = 0;
    const passkeys = createFakePasskeys({
      create: async () => {
        attempts += 1;
        if (attempts === 1) throw new PasskeyCancelled();
        return { id: 'cred-new', rawId: 'cred-new', type: 'public-key', response: {} } as never;
      },
    });
    await renderApp({ initialUrl: '/registro', passkeys });
    await fillStep1();
    await fireEvent.press(await screen.findByRole('button', { name: 'Crear mi passkey' }));
    expect(await screen.findByText('No se creó el passkey. Intente de nuevo')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Crear mi passkey' }));
    expect(await screen.findByText(/Cada pago lo confirma usted en la app/)).toBeTruthy();
  });
});

describe('Registro · paso 3 (permiso en la wallet)', () => {
  it('"Ir a mi wallet" inicia la vinculación y abre la authorizationUrl', async () => {
    await renderApp({ initialUrl: '/vincular', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ir a mi wallet' }));
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith('https://wallet.interledger-test.dev/grant/interact/abc'),
    );
  });

  it('rechaza una authorizationUrl que no sea https', async () => {
    server.use(
      http.post(`${API}/me/wallet-link`, () =>
        HttpResponse.json(
          {
            linkId: 'wl_01',
            authorizationUrl: 'http://evil.test/grant',
            dailyLimit: { value: '200.00', assetCode: 'USD' },
            expiresAt: '2026-10-17T12:10:00.000Z',
          },
          { status: 202 },
        ),
      ),
    );
    await renderApp({ initialUrl: '/vincular', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ir a mi wallet' }));
    expect(await screen.findByText(/No pudimos abrir su wallet/)).toBeTruthy();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('un doble toque en "Ir a mi wallet" hace una sola petición (web: la página se descarga)', async () => {
    const original = Platform.OS;
    Platform.OS = 'web';
    let calls = 0;
    server.use(
      http.post(`${API}/me/wallet-link`, () => {
        calls += 1;
        return HttpResponse.json(
          {
            linkId: 'wl_01',
            authorizationUrl: 'https://wallet.interledger-test.dev/grant/interact/abc',
            dailyLimit: { value: '200.00', assetCode: 'USD' },
            expiresAt: '2026-10-17T12:10:00.000Z',
          },
          { status: 202 },
        );
      }),
    );
    await renderApp({ initialUrl: '/vincular', session });
    const button = await screen.findByRole('button', { name: 'Ir a mi wallet' });
    await fireEvent.press(button);
    await fireEvent.press(button);
    await waitFor(() => expect(openUrl).toHaveBeenCalled());
    expect(calls).toBe(1);
    Platform.OS = original;
  });

  it('CURRENCY_NOT_SUPPORTED avisa que esa moneda todavía no está disponible', async () => {
    server.use(http.post(`${API}/me/wallet-link`, () => apiError('CURRENCY_NOT_SUPPORTED', 422)));
    await renderApp({ initialUrl: '/vincular', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ir a mi wallet' }));
    expect(await screen.findByText(/esa moneda todavía no está disponible/)).toBeTruthy();
  });

  it('WALLET_ALREADY_LINKED lleva al resultado de la vinculación activa', async () => {
    server.use(http.post(`${API}/me/wallet-link`, () => apiError('WALLET_ALREADY_LINKED', 409)));
    await renderApp({ initialUrl: '/vincular', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ir a mi wallet' }));
    expect(await screen.findByText('Su wallet autorizó a TuTranqui')).toBeTruthy();
  });
});

describe('Vuelta desde la wallet', () => {
  const pending = { ...fixtures.walletLink, status: 'PENDING_AUTHORIZATION', isFinal: false };

  it('ACTIVE: "Su wallet autorizó a TuTranqui", el monto diario y "Empezar a pagar"', async () => {
    await renderApp({ initialUrl: '/vincular/resultado?linkId=wl_01&status=ACTIVE', session });
    expect(await screen.findByText('Su wallet autorizó a TuTranqui')).toBeTruthy();
    expect(screen.getByText('US$200,00')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Empezar a pagar' }));
    expect(await screen.findByText(/Hola, bienvenida a TuTranqui/)).toBeTruthy();
  });

  it.each([
    ['REJECTED', /No dio el permiso/],
    ['EXPIRED', /Se venció el tiempo/],
  ])('%s explica qué pasó y ofrece "Intentar de nuevo"', async (status, message) => {
    server.use(
      http.get(`${API}/me/wallet-link`, () =>
        HttpResponse.json({ ...fixtures.walletLink, status, isFinal: true }),
      ),
    );
    await renderApp({ initialUrl: `/vincular/resultado?linkId=wl_01&status=${status}`, session });
    expect(await screen.findByText(message)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByRole('button', { name: 'Ir a mi wallet' })).toBeTruthy();
  });

  it('manda lo que dice la API: el query dice ACTIVE pero la API dice pendiente', async () => {
    server.use(
      http.get(`${API}/me/wallet-link`, () =>
        HttpResponse.json(pending, { headers: { 'Retry-After': '2' } }),
      ),
    );
    await renderApp({ initialUrl: '/vincular/resultado?linkId=wl_01&status=ACTIVE', session });
    expect(await screen.findByText(/Esperando que apruebe el permiso/)).toBeTruthy();
    expect(screen.queryByText('Su wallet autorizó a TuTranqui')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empezar a pagar' })).toBeNull();
  });
});

describe('Inicio sin vinculación', () => {
  it('muestra el aviso para vincular y lleva al paso 3', async () => {
    server.use(http.get(`${API}/me/wallet-link`, () => apiError('LINK_NOT_FOUND', 404)));
    await renderApp({ initialUrl: '/', session });
    expect(await screen.findByText('Vincule su wallet para empezar a pagar')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Vincular mi wallet' }));
    expect(await screen.findByRole('button', { name: 'Ir a mi wallet' })).toBeTruthy();
  });

  it('con la vinculación activa no muestra el aviso', async () => {
    await renderApp({ initialUrl: '/', session });
    await screen.findByText(/Hola, bienvenida a TuTranqui/);
    await act(async () => {});
    expect(screen.queryByText('Vincule su wallet para empezar a pagar')).toBeNull();
  });
});
