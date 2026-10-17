import type { PasskeyService } from '@/features/auth/passkeys';

/** Fake de passkeys para los tests: nunca se usa WebAuthn real. */
export type FakePasskeys = PasskeyService & { calls: { create: unknown[]; authenticate: unknown[] } };

export function createFakePasskeys(overrides: Partial<PasskeyService> = {}): FakePasskeys {
  const calls = { create: [] as unknown[], authenticate: [] as unknown[] };
  return {
    calls,
    isSupported: async () => true,
    create: async (options) => {
      calls.create.push(options);
      return { id: 'cred-new', rawId: 'cred-new', type: 'public-key', response: {} } as never;
    },
    authenticate: async (options) => {
      calls.authenticate.push(options);
      return { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} } as never;
    },
    ...overrides,
  };
}
