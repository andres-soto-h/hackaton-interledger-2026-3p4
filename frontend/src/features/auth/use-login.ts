import { useCallback } from 'react';
import { ApiError } from '@/api/client';
import { authApi } from './api';
import { PasskeyCancelled } from './passkeys';
import { usePasskeys } from './passkeys-context';
import { useSession } from './session';

/** Flujo de ingreso: opciones → passkey → verificación → sesión. Sirve también para reautenticar (sin correo). */
export function useLogin() {
  const passkeys = usePasskeys();
  const { signIn } = useSession();
  return useCallback(async (email?: string) => {
    const { challengeId, ...options } = await authApi.loginOptions(email);
    const credential = await passkeys.authenticate(options);
    await signIn(await authApi.loginVerify({ challengeId, credential }));
  }, [passkeys, signIn]);
}

/** Ejecuta una acción sensible; si la API pide sesión reciente, pide el passkey y reintenta una vez. */
export function useReauthAction() {
  const login = useLogin();
  return useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'REAUTH_REQUIRED') {
          await login();
          return action();
        }
        throw error;
      }
    },
    [login],
  );
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof PasskeyCancelled) return 'No se completó el ingreso. Intente de nuevo';
  if (error instanceof ApiError) {
    if (error.code === 'PASSKEY_VERIFICATION_FAILED') {
      return 'No reconocimos ese passkey. Intente de nuevo o cree una cuenta.';
    }
    if (error.code === 'CHALLENGE_EXPIRED') {
      return 'Se venció el tiempo para ingresar. Intente de nuevo.';
    }
    if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') {
      return 'No pudimos conectarnos. Revise su internet e intente de nuevo.';
    }
  }
  return 'No pudimos ingresar. Intente de nuevo.';
}
