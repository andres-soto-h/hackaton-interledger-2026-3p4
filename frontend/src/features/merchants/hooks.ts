import { useMemo } from 'react';
import { MOCK_MERCHANTS } from './mock-merchants';
import { filterMerchants } from './search';
import type { Merchant, MerchantCategory } from './types';

/**
 * Fuente única del directorio. Hoy devuelve la lista simulada; al conectar el backend
 * (`GET /merchants`) solo cambia esta función y las pantallas siguen igual.
 */
export function useMerchants(query = '', category?: MerchantCategory): { merchants: Merchant[] } {
  return useMemo(
    () => ({ merchants: filterMerchants(MOCK_MERCHANTS, query, category) }),
    [query, category],
  );
}

export function useMerchant(id: string | undefined): Merchant | undefined {
  return useMemo(() => MOCK_MERCHANTS.find((m) => m.id === id), [id]);
}
