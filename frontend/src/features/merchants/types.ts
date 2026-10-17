export type MerchantCategory = 'energia' | 'agua' | 'gas' | 'celular' | 'internet';

export type Merchant = {
  id: string;
  name: string;
  category: MerchantCategory;
  walletAddress: string;
  /** Los pagos a comercios son solo en COP (decisión del responsable, 2026-10-17). */
  assetCode: 'COP';
  assetScale: number;
  referenceLabel: string;
  logoUrl?: string;
};

export const CATEGORY_LABELS: Record<MerchantCategory, string> = {
  energia: 'Energía',
  agua: 'Agua',
  gas: 'Gas',
  celular: 'Celular',
  internet: 'Internet',
};
