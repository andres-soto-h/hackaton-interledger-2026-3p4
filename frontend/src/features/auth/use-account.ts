import { useQuery } from '@tanstack/react-query';
import { authApi } from './api';

export const accountKeys = {
  me: ['me'] as const,
  walletLink: ['me', 'wallet-link'] as const,
  allowance: ['me', 'allowance'] as const,
};

export const useMe = () => useQuery({ queryKey: accountKeys.me, queryFn: authApi.getMe });
export const useWalletLink = () =>
  useQuery({ queryKey: accountKeys.walletLink, queryFn: authApi.getWalletLink });
export const useAllowance = (enabled: boolean) =>
  useQuery({ queryKey: accountKeys.allowance, queryFn: authApi.getAllowance, enabled });
