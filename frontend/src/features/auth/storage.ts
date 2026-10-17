import { Platform } from 'react-native';
import type { Session } from './types';

export interface SessionStore {
  load(): Promise<Session | null>;
  save(session: Session): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'tutranqui.session';

function isValid(value: unknown): value is Session {
  const s = value as Session | null;
  return (
    !!s &&
    typeof s.token === 'string' &&
    typeof s.expiresAt === 'string' &&
    !!s.user &&
    typeof s.user.id === 'string' &&
    Date.parse(s.expiresAt) > Date.now()
  );
}

export function createMemorySessionStore(): SessionStore {
  let current: Session | null = null;
  return {
    load: async () => (isValid(current) ? current : null),
    save: async (session) => {
      current = session;
    },
    clear: async () => {
      current = null;
    },
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Sesión en `sessionStorage`: se pierde al cerrar la pestaña y no se comparte con otras
 * (decisión 5 del backend 019: se evita `localStorage` para reducir el impacto de un XSS).
 * Si el almacenamiento está bloqueado, la app sigue funcionando solo con la sesión en memoria.
 */
export function createWebSessionStore(storage: StorageLike): SessionStore {
  return {
    load: async () => {
      try {
        const raw = storage.getItem(KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return isValid(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    save: async (session) => {
      try {
        storage.setItem(KEY, JSON.stringify(session));
      } catch {
        // sin almacenamiento: queda solo en memoria
      }
    },
    clear: async () => {
      try {
        storage.removeItem(KEY);
      } catch {
        // nada que limpiar
      }
    },
  };
}

export function createDefaultSessionStore(): SessionStore {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      return createWebSessionStore(window.sessionStorage);
    } catch {
      return createMemorySessionStore();
    }
  }
  return createMemorySessionStore();
}
