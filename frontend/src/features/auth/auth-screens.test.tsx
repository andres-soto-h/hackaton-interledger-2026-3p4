import { act, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { apiError, fixtures } from '../../../tests/msw/auth';
import { createFakePasskeys } from '../../../tests/utils/fake-passkeys';
import { renderApp } from '../../../tests/utils/render-app';
import { PasskeyCancelled } from './passkeys';
import type { Session } from './types';

const session: Session = { ...fixtures.session, user: fixtures.user };

describe('Ingreso con passkey', () => {
  it('ingresa: options → passkey → verify con challengeId, y va al inicio', async () => {
    let verifyBody: { challengeId?: string; credential?: { id: string } } = {};
    server.use(
      http.post(`${API}/auth/login/verify`, async ({ request }) => {
        verifyBody = (await request.json()) as typeof verifyBody;
        return HttpResponse.json({ user: fixtures.user, session: fixtures.session });
      }),
    );
    const app = await renderApp({ initialUrl: '/ingresar' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ingresar con mi passkey' }));

    expect(await screen.findByText(/Hola, bienvenida a TuTranqui/)).toBeTruthy();
    expect(verifyBody.challengeId).toBe('chl_login');
    expect(verifyBody.credential?.id).toBe('cred-1');
    expect(app.passkeys.calls.authenticate).toHaveLength(1);
  });

  it('cancelar el diálogo deja un mensaje amable y no navega', async () => {
    await renderApp({
      initialUrl: '/ingresar',
      passkeys: createFakePasskeys({
        authenticate: async () => {
          throw new PasskeyCancelled();
        },
      }),
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ingresar con mi passkey' }));
    expect(await screen.findByText('No se completó el ingreso. Intente de nuevo')).toBeTruthy();
    expect(screen.queryByText(/Hola, bienvenida/)).toBeNull();
  });

  it.each([
    ['PASSKEY_VERIFICATION_FAILED', /No reconocimos ese passkey/],
    ['CHALLENGE_EXPIRED', /Se venció el tiempo/],
  ])('muestra el mensaje de %s', async (code, message) => {
    server.use(http.post(`${API}/auth/login/verify`, () => apiError(code, 400)));
    await renderApp({ initialUrl: '/ingresar' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ingresar con mi passkey' }));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('sin soporte de passkeys, avisa y no ofrece ingresar ni crear cuenta', async () => {
    await renderApp({
      initialUrl: '/bienvenida',
      passkeys: createFakePasskeys({ isSupported: async () => false }),
    });
    expect(await screen.findByText(/necesita un navegador compatible/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crear cuenta' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ya tengo cuenta' })).toBeNull();
  });
});

describe('Guards de rutas', () => {
  it('sin sesión, una ruta privada lleva a ingresar y al ingresar vuelve a la ruta pedida', async () => {
    await renderApp({ initialUrl: '/cuenta' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ingresar con mi passkey' }));
    expect(await screen.findByText('Mi cuenta')).toBeTruthy();
  });

  it('con sesión, una ruta pública lleva al inicio', async () => {
    await renderApp({ initialUrl: '/ingresar', session });
    expect(await screen.findByText(/Hola, bienvenida a TuTranqui/)).toBeTruthy();
  });

  it('la bienvenida lleva a ingresar con "Ya tengo cuenta"', async () => {
    await renderApp({ initialUrl: '/bienvenida' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Ya tengo cuenta' }));
    expect(await screen.findByRole('button', { name: 'Ingresar con mi passkey' })).toBeTruthy();
  });

  it('un 401 cierra la sesión y el ingreso lo avisa', async () => {
    server.use(http.get(`${API}/me`, () => apiError('SESSION_INVALID', 401)));
    await renderApp({ initialUrl: '/cuenta', session });
    expect(await screen.findByText('Su sesión terminó, ingrese de nuevo')).toBeTruthy();
  });
});

describe('Mi cuenta', () => {
  it('muestra nombre, wallet, permiso activo, monto diario y disponible', async () => {
    await renderApp({ initialUrl: '/cuenta', session });
    expect(await screen.findByText('Claudia Pérez')).toBeTruthy();
    expect(screen.getByText('https://ilp.interledger-test.dev/claudia')).toBeTruthy();
    expect(await screen.findByText('Permiso activo')).toBeTruthy();
    expect(screen.getByText('US$200,00')).toBeTruthy();
    expect(screen.getByText('US$154,50')).toBeTruthy();
  });

  it('sin vinculación (404) ofrece vincular', async () => {
    server.use(http.get(`${API}/me/wallet-link`, () => apiError('LINK_NOT_FOUND', 404)));
    await renderApp({ initialUrl: '/cuenta', session });
    expect(await screen.findByText('Todavía no ha dado permiso en su wallet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vincular mi wallet' })).toBeTruthy();
  });

  it('quitar permiso pide confirmación, llama DELETE y reintenta tras REAUTH_REQUIRED', async () => {
    let calls = 0;
    server.use(
      http.delete(`${API}/me/wallet-link`, () => {
        calls += 1;
        return calls === 1 ? apiError('REAUTH_REQUIRED', 401) : new HttpResponse(null, { status: 204 });
      }),
    );
    const app = await renderApp({ initialUrl: '/cuenta', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Quitar permiso' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, quitar permiso' }));
    await waitFor(() => expect(calls).toBe(2));
    expect(app.passkeys.calls.authenticate).toHaveLength(1);
    expect(await screen.findByText('Todavía no ha dado permiso en su wallet')).toBeTruthy();
  });

  it('eliminar la cuenta llama DELETE /me y muestra el aviso en la bienvenida', async () => {
    let deleted = false;
    server.use(
      http.delete(`${API}/me`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderApp({ initialUrl: '/cuenta', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Eliminar mi cuenta' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, eliminar mi cuenta' }));
    expect(await screen.findByText(/Su cuenta fue eliminada/)).toBeTruthy();
    expect(deleted).toBe(true);
  });

  it('eliminar la cuenta con REAUTH_REQUIRED pide el passkey y reintenta', async () => {
    let calls = 0;
    server.use(
      http.delete(`${API}/me`, () => {
        calls += 1;
        return calls === 1 ? apiError('REAUTH_REQUIRED', 401) : new HttpResponse(null, { status: 204 });
      }),
    );
    const app = await renderApp({ initialUrl: '/cuenta', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Eliminar mi cuenta' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, eliminar mi cuenta' }));
    expect(await screen.findByText(/Su cuenta fue eliminada/)).toBeTruthy();
    expect(calls).toBe(2);
    expect(app.passkeys.calls.authenticate).toHaveLength(1);
  });

  it('cerrar sesión borra la sesión y lleva a la bienvenida', async () => {
    const app = await renderApp({ initialUrl: '/cuenta', session });
    await fireEvent.press(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Sí, cerrar sesión' }));
    expect(await screen.findByText(/Qué es TuTranqui|Pague sus servicios/)).toBeTruthy();
    await act(async () => {});
    expect(await app.store.load()).toBeNull();
  });
});
