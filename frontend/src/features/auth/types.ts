import type { Amount } from '@/lib/money';

export type User = {
  id: string;
  displayName: string;
  walletAddress: string;
  createdAt: string;
};

export type Session = { token: string; expiresAt: string; user: User };

export type ApiSession = { token: string; expiresAt: string };

export type AuthResult = { user: User; session: ApiSession };

export type WalletLinkStatusValue =
  | 'PENDING_AUTHORIZATION'
  | 'ACTIVE'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REVOKED';

export type WalletLink = {
  linkId: string;
  status: WalletLinkStatusValue;
  isFinal: boolean;
  walletVerified: boolean;
  dailyLimit: Amount;
};

export type Allowance = {
  dailyLimit: Amount;
  spent: Amount;
  available: Amount;
  periodStart: string;
  periodEnd: string;
};
