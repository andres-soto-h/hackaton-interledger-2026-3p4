import { Text } from 'react-native';
import { screen, act } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/msw/server';
import { API } from '../../../tests/msw/config';
import { renderWithProviders } from '../../../tests/utils/render';
import { apiClient } from '@/api/client';
import { createMemorySessionStore } from './storage';
import { useSession } from './session';
import type { Session } from './types';

const user = { id: 'usr_1', displayName: 'Ana', walletAddress: 'https://w.test/ana', createdAt: '2026-10-17T00:00:00Z' };
const valid: Session = { token: 'tok_ok', expiresAt: new Date(Date.now() + 3600_000).toISOString(), user };
const expired: Session = { ...valid, expiresAt: new Date(Date.now() - 1000).toISOString() };

function Probe() {
  const { status, user: u } = useSession();
  return <Text>{`${status}:${u?.displayName ?? '-'}`}</Text>;
}

async function storeWith(session: Session | null) {
  const store = createMemorySessionStore();
  if (session) await store.save(session);
  return store;
}

describe('SessionProvider', () => {
  it('restaura una sesión vigente', async () => {
    await renderWithProviders(<Probe />, { store: await storeWith(valid), skipSessionSeed: true });
    expect(await screen.findByText('signedIn:Ana')).toBeTruthy();
  });

  it('descarta una sesión vencida', async () => {
    await renderWithProviders(<Probe />, { store: await storeWith(expired), skipSessionSeed: true });
    expect(await screen.findByText('signedOut:-')).toBeTruthy();
  });

  it('envía el token en las peticiones y un 401 cierra la sesión y limpia la caché', async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${API}/me`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json({ error: { code: 'SESSION_INVALID', message: 'x' } }, { status: 401 });
      }),
    );
    const { queryClient } = await renderWithProviders(<Probe />, {
      store: await storeWith(valid),
      skipSessionSeed: true,
    });
    await screen.findByText('signedIn:Ana');
    queryClient.setQueryData(['algo'], { privado: true });

    await act(async () => {
      await apiClient.get('/me').catch(() => undefined);
    });

    expect(auth).toBe('Bearer tok_ok');
    expect(await screen.findByText('signedOut:-')).toBeTruthy();
    expect(queryClient.getQueryData(['algo'])).toBeUndefined();
  });
});
