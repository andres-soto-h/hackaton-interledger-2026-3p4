import type { WalletLink } from '@/features/auth/types';

const DEFAULT_DELAY_MS = 2000;

/** Cuánto esperar antes de volver a consultar la vinculación; `false` si ya no cambia. */
export function nextPollDelayMs(
  link: WalletLink | null | undefined,
  retryAfterSeconds: number | undefined,
): number | false {
  if (!link || link.isFinal) return false;
  return retryAfterSeconds ? retryAfterSeconds * 1000 : DEFAULT_DELAY_MS;
}
