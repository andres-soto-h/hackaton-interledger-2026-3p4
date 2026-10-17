import { formatMoney, toSpokenAmount, type Amount } from '@/lib/money';
import { counterpartyName } from '@/features/transactions/format';
import type { PaymentDetail } from '@/features/transactions/types';
import type { PaymentQuote } from './api';

export type ConfirmationView = {
  paymentId: string;
  status: string;
  merchantName: string;
  description?: string | null;
  receive: Amount;
  debit: Amount;
  fee?: Amount & { percentage?: string };
  totalDebit: Amount;
  exchangeRate?: string;
  dailyLimit?: Amount;
  availableAfter?: Amount;
  confirmBy?: string;
};

/** Lo que dejó el spec 005 en la caché (la respuesta de `POST /payments` + el nombre del comercio). */
export type QuoteSource = (PaymentQuote & { merchantName?: string }) | PaymentDetail;

/** "EPM · número de contrato 7731" → "EPM"; sin descripción, host y ruta de la wallet. */
export function merchantNameFrom(description: string | null | undefined, walletAddress: string | undefined): string {
  const first = description?.split(' · ')[0]?.trim();
  if (first) return first;
  return counterpartyName({ name: null, walletAddress: walletAddress ?? '' });
}

export function toConfirmationView(source: QuoteSource): ConfirmationView {
  if ('quote' in source) {
    const { quote, allowance } = source;
    return {
      paymentId: source.paymentId,
      status: source.status,
      merchantName: source.merchantName ?? 'el comercio',
      receive: quote.receiveAmount,
      debit: quote.debitAmount,
      fee: quote.fee,
      totalDebit: quote.totalDebit,
      exchangeRate: quote.exchangeRate,
      dailyLimit: allowance?.dailyLimit,
      availableAfter: allowance?.availableAfter,
      confirmBy: source.confirmBy,
    };
  }
  return {
    paymentId: source.paymentId,
    status: source.status,
    merchantName: merchantNameFrom(source.description, source.receiverWalletAddress),
    description: source.description,
    receive: source.receiveAmount,
    debit: source.debitAmount,
    fee: source.fee,
    totalDebit: source.totalDebit ?? source.debitAmount,
  };
}

export type BreakdownRow = { id: string; label: string; detail?: string; value: string; strong?: boolean };

const isZero = (a?: Amount) => !a || !/[1-9]/.test(a.value);

export function buildBreakdown(v: ConfirmationView): BreakdownRow[] {
  const rows: BreakdownRow[] = [
    { id: 'to', label: 'Le paga a', value: v.merchantName },
    { id: 'receive', label: 'Recibe', value: formatMoney(v.receive) },
  ];
  if (v.exchangeRate && v.receive.assetCode !== v.totalDebit.assetCode) {
    rows.push({
      id: 'rate',
      label: 'Tasa de cambio',
      detail: 'Vale hasta que vence el tiempo',
      value: v.exchangeRate,
    });
  }
  if (v.fee) {
    rows.push({
      id: 'fee',
      label: 'Comisión TuTranqui',
      ...(v.fee.percentage ? { detail: `${v.fee.percentage} %` } : {}),
      value: formatMoney(v.fee),
    });
  }
  rows.push({ id: 'total', label: 'Total que sale', value: formatMoney(v.totalDebit), strong: true });
  if (v.availableAfter) {
    rows.push({
      id: 'left',
      label: 'Le queda hoy',
      ...(v.dailyLimit ? { detail: `de ${formatMoney(v.dailyLimit)}` } : {}),
      value: formatMoney(v.availableAfter),
    });
  }
  return rows;
}

/** Frase para el lector de pantalla y la voz (spec 009): montos en palabras. */
export function buildSpokenSummary(v: ConfirmationView): string {
  const base = `La factura es de ${toSpokenAmount(v.receive)}`;
  const fee = isZero(v.fee) ? '' : `, más ${toSpokenAmount(v.fee!)} de comisión`;
  return `${base}${fee}. ¿Hacemos el pago?`;
}
