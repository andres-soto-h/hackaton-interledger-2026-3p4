import { apiClient, ApiError } from '@/api/client';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import type { CreationOptions, RequestOptions } from './passkeys';
import type { Allowance, AuthResult, User, WalletLink } from './types';

/** Opciones de WebAuthn + el id del desafío, tal como las devuelve el backend. */
export type ChallengeOptions = RequestOptions & { challengeId: string };

export type RegistrationChallenge = CreationOptions & { challengeId: string };

export const authApi = {
  registerOptions: (body: { displayName: string; email: string; walletAddress: string }) =>
    apiClient.post<RegistrationChallenge>('/auth/register/options', body),
  registerVerify: (body: { challengeId: string; credential: RegistrationResponseJSON }) =>
    apiClient.post<AuthResult>('/auth/register/verify', body),
  loginOptions: () => apiClient.post<ChallengeOptions>('/auth/login/options'),
  loginVerify: (body: { challengeId: string; credential: AuthenticationResponseJSON }) =>
    apiClient.post<AuthResult>('/auth/login/verify', body),
  getMe: () => apiClient.get<User>('/me'),
  deleteMe: () => apiClient.delete('/me'),
  /** `null` si la cuenta todavía no tiene vinculación (404 LINK_NOT_FOUND). */
  getWalletLink: async (): Promise<WalletLink | null> => {
    try {
      return await apiClient.get<WalletLink>('/me/wallet-link');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  deleteWalletLink: () => apiClient.delete('/me/wallet-link'),
  getAllowance: async (): Promise<Allowance | null> => {
    try {
      return await apiClient.get<Allowance>('/me/allowance');
    } catch (error) {
      // Sin vinculación activa no hay monto diario que mostrar.
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
      throw error;
    }
  },
};
