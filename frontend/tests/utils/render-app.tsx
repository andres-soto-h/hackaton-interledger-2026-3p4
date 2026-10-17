import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { PasskeysProvider } from '@/features/auth/passkeys-context';
import { SessionProvider } from '@/features/auth/session';
import { createMemorySessionStore } from '@/features/auth/storage';
import type { Session } from '@/features/auth/types';
import { createFakePasskeys, type FakePasskeys } from './fake-passkeys';

type Screens = Record<string, ComponentType>;

type Options = {
  initialUrl: string;
  session?: Session | null;
  passkeys?: FakePasskeys;
  /** Rutas extra de la feature que se prueba (se suman a las de auth). */
  screens?: Screens;
};

/* eslint-disable @typescript-eslint/no-require-imports */
const baseScreens = (): Screens => ({
  '(publico)/_layout': require('../../app/(publico)/_layout').default,
  '(publico)/bienvenida': require('../../app/(publico)/bienvenida').default,
  '(publico)/registro': require('../../app/(publico)/registro').default,
  '(publico)/ingresar': require('../../app/(publico)/ingresar').default,
  '(app)/_layout': require('../../app/(app)/_layout').default,
  '(app)/index': require('../../app/(app)/index').default,
  '(app)/vincular/index': require('../../app/(app)/vincular/index').default,
  '(app)/vincular/resultado': require('../../app/(app)/vincular/resultado').default,
  '(app)/transacciones/index': require('../../app/(app)/transacciones/index').default,
  '(app)/transacciones/[paymentId]': require('../../app/(app)/transacciones/[paymentId]').default,
  '(app)/cuenta': require('../../app/(app)/cuenta').default,
});
/* eslint-enable @typescript-eslint/no-require-imports */

/** Monta las rutas reales de `app/` con los providers de prueba y el router en memoria. */
export async function renderApp({ initialUrl, session = null, passkeys, screens }: Options) {
  const store = createMemorySessionStore();
  if (session) await store.save(session);
  const fakePasskeys = passkeys ?? createFakePasskeys();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const Root = () => (
    <QueryClientProvider client={queryClient}>
      <SessionProvider store={store}>
        <PasskeysProvider service={fakePasskeys}>
          <Slot />
        </PasskeysProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
  const result = await renderRouter({ _layout: Root, ...baseScreens(), ...screens }, { initialUrl });
  return { queryClient, passkeys: fakePasskeys, store, ...result };
}
