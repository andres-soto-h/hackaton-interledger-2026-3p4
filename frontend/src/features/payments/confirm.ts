import { apiClient, ApiError } from '@/api/client';
import { flattenChallenge, PasskeyCancelled, type PasskeyService, type RequestOptions } from '@/features/auth/passkeys';
import { newIdempotencyKey } from '@/lib/uuid';

type ConfirmChallenge = RequestOptions & { challengeId: string };
export type ConfirmResult = { paymentId: string; status: string };

/** Desafío → passkey → confirmación (backend 007). La firma exige que la persona desbloquee su dispositivo. */
export async function confirmPayment(paymentId: string, passkeys: PasskeyService): Promise<ConfirmResult> {
  const id = encodeURIComponent(paymentId);
  const { challengeId, ...options } = flattenChallenge<ConfirmChallenge>(
    await apiClient.post<unknown>(`/payments/${id}/confirm/options`),
  );
  const credential = await passkeys.authenticate(options);
  // Llave nueva por intento: el body cambia (otro desafío) y la API ya impide el doble pago.
  return apiClient.post<ConfirmResult>(
    `/payments/${id}/confirm`,
    { challengeId, credential },
    { idempotencyKey: newIdempotencyKey() },
  );
}

export const cancelPayment = (paymentId: string) =>
  apiClient.post<void>(`/payments/${encodeURIComponent(paymentId)}/cancel`);

export type ConfirmErrorKind =
  | 'cancelled'
  | 'daily-limit'
  | 'expired'
  | 'retry'
  | 'relink'
  | 'not-confirmable'
  | 'unknown';

export function confirmErrorKind(error: unknown): ConfirmErrorKind {
  if (error instanceof PasskeyCancelled) return 'cancelled';
  if (!(error instanceof ApiError)) return 'unknown';
  switch (error.code) {
    case 'DAILY_LIMIT_EXCEEDED':
      return 'daily-limit';
    case 'QUOTE_EXPIRED':
      return 'expired';
    case 'CHALLENGE_EXPIRED':
    case 'PASSKEY_VERIFICATION_FAILED':
      return 'retry';
    case 'WALLET_NOT_LINKED':
    case 'WALLET_LINK_REVOKED':
      return 'relink';
    case 'PAYMENT_NOT_CONFIRMABLE':
      return 'not-confirmable';
    default:
      return 'unknown';
  }
}
