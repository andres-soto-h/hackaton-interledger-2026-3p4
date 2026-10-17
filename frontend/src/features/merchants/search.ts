import type { Merchant, MerchantCategory } from './types';

/** Minúsculas y sin tildes: "Épm" == "epm". */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function filterMerchants(
  merchants: Merchant[],
  query: string,
  category?: MerchantCategory,
): Merchant[] {
  const q = normalizeText(query);
  return merchants.filter(
    (m) => (!category || m.category === category) && (!q || normalizeText(m.name).includes(q)),
  );
}
