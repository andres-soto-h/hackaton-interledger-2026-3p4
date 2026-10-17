import { apiClient, ApiError } from '@/api/client';
import type { Amount } from '@/lib/money';
import type { WalletLink } from '@/features/auth/types';

export type WalletLinkStart = {
  linkId: string;
  authorizationUrl: string;
  dailyLimit: Amount;
  expiresAt: string;
};

export type PolledWalletLink = { link: WalletLink | null; retryAfterSeconds?: number };

export const walletLinkApi = {
  start: () => apiClient.post<WalletLinkStart>('/me/wallet-link'),
  /** Estado de la vinculación con el `Retry-After` de la API; `link: null` si no hay ninguna. */
  getPolled: async (): Promise<PolledWalletLink> => {
    try {
      const { data, retryAfterSeconds } = await apiClient.getWithHeaders<WalletLink>('/me/wallet-link');
      return { link: data, retryAfterSeconds };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { link: null };
      throw error;
    }
  },
};
