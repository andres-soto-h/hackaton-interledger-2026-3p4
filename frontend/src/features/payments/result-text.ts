import { formatMoney } from '@/lib/money';
import type { PaymentDetail } from '@/features/transactions/types';

const FAILURE_REASONS: Record<string, string> = {
  WALLET_LINK_REVOKED: 'El permiso en su wallet ya no está activo.',
  DAILY_LIMIT_EXCEEDED: 'El pago pasaba su monto de hoy.',
  INSUFFICIENT_FUNDS: 'No había saldo suficiente en su wallet.',
  OPEN_PAYMENTS_UNAVAILABLE: 'No pudimos comunicarnos con la red de pagos.',
};

const hasValue = (a?: { value: string } | null) => !!a && /[1-9]/.test(a.value);

/** Explica un pago fallido en lenguaje simple; dice si se debitó algo (`sentAmount`). */
export function failureDetail(payment: PaymentDetail): string {
  const reason = (payment.error && FAILURE_REASONS[payment.error.code]) || 'No pudimos completar el pago.';
  const debited = hasValue(payment.sentAmount)
    ? `Se debitaron ${formatMoney(payment.sentAmount!)} de su wallet. Escríbanos para ayudarle.`
    : 'No se debitó nada.';
  return `${reason} ${debited}`;
}
