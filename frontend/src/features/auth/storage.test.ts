import { createMemorySessionStore, createWebSessionStore } from './storage';
import type { Session } from './types';

const user = { id: 'usr_1', displayName: 'Ana', walletAddress: 'https://w.test/ana', createdAt: '2026-10-17T00:00:00Z' };
const future = (ms: number) => new Date(Date.now() + ms).toISOString();
const session = (expiresAt: string): Session => ({ token: 'tok', expiresAt, user });

describe.each([
  ['memoria', () => createMemorySessionStore()],
  [
    'sessionStorage (web)',
    () => {
      const data = new Map<string, string>();
      return createWebSessionStore({
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
      });
    },
  ],
])('SessionStore en %s', (_name, make) => {
  it('guarda, lee y borra la sesión', async () => {
    const store = make();
    expect(await store.load()).toBeNull();
    await store.save(session(future(60_000)));
    expect((await store.load())?.token).toBe('tok');
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('descarta una sesión vencida', async () => {
    const store = make();
    await store.save(session(new Date(Date.now() - 1000).toISOString()));
    expect(await store.load()).toBeNull();
  });
});

describe('createWebSessionStore', () => {
  it('ignora contenido corrupto', async () => {
    const store = createWebSessionStore({
      getItem: () => '{no es json',
      setItem: () => {},
      removeItem: () => {},
    });
    expect(await store.load()).toBeNull();
  });

  it('no falla si sessionStorage lanza (modo privado o bloqueado)', async () => {
    const boom = () => {
      throw new Error('bloqueado');
    };
    const store = createWebSessionStore({ getItem: boom, setItem: boom, removeItem: boom });
    await expect(store.save(session(future(1000)))).resolves.toBeUndefined();
    expect(await store.load()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
