import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createBypassPasskeyService,
  createPasskeyService,
  isPasskeyBypassEnabled,
  type PasskeyService,
} from './passkeys';

const PasskeysContext = createContext<PasskeyService | null>(null);

export function PasskeysProvider({
  service,
  children,
}: {
  service?: PasskeyService;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    if (service) return service;
    return isPasskeyBypassEnabled() ? createBypassPasskeyService() : createPasskeyService();
  }, [service]);
  return <PasskeysContext.Provider value={value}>{children}</PasskeysContext.Provider>;
}

export function usePasskeys(): PasskeyService {
  const service = useContext(PasskeysContext);
  if (!service) throw new Error('usePasskeys necesita <PasskeysProvider>');
  return service;
}
