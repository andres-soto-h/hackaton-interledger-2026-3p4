import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiClient } from '@/api/client';
import { createDefaultSessionStore, type SessionStore } from './storage';
import type { AuthResult, Session, User } from './types';

type Status = 'loading' | 'signedIn' | 'signedOut';

type SessionContextValue = {
  status: Status;
  user?: User;
  token?: string;
  /** `true` si la sesión se cerró sola (401 o vencida): el ingreso lo avisa. */
  sessionEnded: boolean;
  signIn: (result: AuthResult) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

type Props = { store?: SessionStore; client?: ApiClient; children: ReactNode };

export function SessionProvider({ store: storeProp, client = apiClient, children }: Props) {
  const queryClient = useQueryClient();
  const store = useMemo(() => storeProp ?? createDefaultSessionStore(), [storeProp]);
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    store.load().then((restored) => {
      if (!active) return;
      tokenRef.current = restored?.token ?? null;
      setSession(restored);
      setStatus(restored ? 'signedIn' : 'signedOut');
    });
    return () => {
      active = false;
    };
  }, [store]);

  const end = useCallback(
    async (ended: boolean) => {
      tokenRef.current = null;
      setSession(null);
      setSessionEnded(ended);
      setStatus('signedOut');
      queryClient.clear();
      await store.clear();
    },
    [queryClient, store],
  );

  useEffect(() => {
    client.setTokenProvider(() => tokenRef.current);
    client.onUnauthorized(() => {
      if (tokenRef.current) void end(true);
    });
  }, [client, end]);

  const signIn = useCallback(
    async ({ user, session: api }: AuthResult) => {
      const next: Session = { token: api.token, expiresAt: api.expiresAt, user };
      tokenRef.current = next.token;
      setSession(next);
      setSessionEnded(false);
      setStatus('signedIn');
      await store.save(next);
    },
    [store],
  );

  const signOut = useCallback(() => end(false), [end]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user: session?.user,
      token: session?.token,
      sessionEnded,
      signIn,
      signOut,
    }),
    [status, session, sessionEnded, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession necesita <SessionProvider>');
  return value;
}
