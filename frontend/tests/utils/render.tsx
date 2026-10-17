import { render, type RenderOptions } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { PasskeysProvider } from '@/features/auth/passkeys-context';
import { SessionProvider } from '@/features/auth/session';
import { createMemorySessionStore, type SessionStore } from '@/features/auth/storage';
import type { Session } from '@/features/auth/types';
import { createFakePasskeys, type FakePasskeys } from './fake-passkeys';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

type Options = RenderOptions & {
  /** Sesión inicial (por omisión, sin sesión). */
  session?: Session | null;
  store?: SessionStore;
  /** Usado por los tests del propio SessionProvider: no precarga `session`. */
  skipSessionSeed?: boolean;
  passkeys?: FakePasskeys;
};

/** Renderiza con los providers de la app: TanStack Query, sesión y passkeys (fake). */
export async function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const { session = null, store, skipSessionSeed, passkeys, ...renderOptions } = options;
  const queryClient = createTestQueryClient();
  const sessionStore = store ?? createMemorySessionStore();
  if (!skipSessionSeed && session) await sessionStore.save(session);
  const fakePasskeys = passkeys ?? createFakePasskeys();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SessionProvider store={sessionStore}>
        <PasskeysProvider service={fakePasskeys}>{children}</PasskeysProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
  return {
    queryClient,
    passkeys: fakePasskeys,
    ...(await render(ui, { wrapper: Wrapper, ...renderOptions })),
  };
}
