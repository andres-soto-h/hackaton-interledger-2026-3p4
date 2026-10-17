import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Merchant } from '@/features/merchants/types';
import { buildValidationSteps, verifyWallet, type ValidationStep } from './verify';

const REVEAL_MS = 350;

/** Verifica la wallet y va mostrando los pasos uno a uno (animación de la pantalla 1.6). */
export function useMerchantValidation(merchant: Merchant) {
  const query = useQuery({
    queryKey: ['wallet-verify', merchant.walletAddress],
    queryFn: () => verifyWallet(merchant),
    gcTime: 0,
  });
  const steps: ValidationStep[] = query.data ? buildValidationSteps(merchant, query.data) : [];
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (!query.data || revealed >= steps.length) return;
    const timer = setTimeout(() => setRevealed((n) => n + 1), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [query.data, revealed, steps.length]);

  return {
    steps,
    revealed,
    done: !!query.data && revealed >= steps.length,
    isError: query.isError,
    retry: () => query.refetch(),
  };
}
