import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

/** Comercio "seguro": listado por el backend (`GET /merchants`), con monto fijo o a ingresar. */
export type SafeMerchant = {
  id: string;
  name: string;
  walletAddress: string;
  assetCode: 'COP';
  assetScale: number;
  /** Monto fijo de la factura; `null` si el usuario ingresa el monto manualmente. */
  fixedAmount: string | null;
};

export const merchantsApi = {
  list: () => apiClient.get<{ items: SafeMerchant[] }>('/merchants'),
};

export function useSafeMerchants() {
  return useQuery({ queryKey: ['merchants'], queryFn: merchantsApi.list });
}
