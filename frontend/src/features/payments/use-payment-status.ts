import { useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import { usePayment } from '@/features/transactions/hooks';

export type PaymentPhase = 'polling' | 'final' | 'timeout' | 'notFound';

const FINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'];
const MAX_MS = 120_000;

/** Sigue el pago según `Retry-After` hasta `isFinal`, con un tope de 2 minutos (spec 007). */
export function usePaymentStatus(paymentId: string, { maxMs = MAX_MS }: { maxMs?: number } = {}) {
  const [timedOut, setTimedOut] = useState(false);
  const [round, setRound] = useState(0);
  const query = usePayment(paymentId, { enabled: !timedOut });
  const payment = query.data?.payment;
  const isFinal = payment ? (payment.isFinal ?? FINAL.includes(payment.status)) : false;

  useEffect(() => {
    if (isFinal || timedOut) return;
    const timer = setTimeout(() => setTimedOut(true), maxMs);
    return () => clearTimeout(timer);
  }, [isFinal, timedOut, maxMs, round]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const phase: PaymentPhase = notFound ? 'notFound' : isFinal ? 'final' : timedOut ? 'timeout' : 'polling';

  return {
    payment,
    phase,
    isError: query.isError && !notFound,
    refetch: query.refetch,
    retry: () => {
      setTimedOut(false);
      setRound((n) => n + 1);
      void query.refetch();
    },
  };
}
