import { render, type RenderOptions } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

/** Renderiza con los providers de la app (hoy: TanStack Query; el tema son tokens importados). */
export async function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = createTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...(await render(ui, { wrapper: Wrapper, ...options })) };
}
