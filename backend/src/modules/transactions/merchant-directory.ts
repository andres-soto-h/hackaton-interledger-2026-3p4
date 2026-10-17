export interface Merchant {
  id: string
  name: string
}

export interface MerchantDirectory {
  findByWallet(walletAddress: string): Promise<Merchant | null>
}

/**
 * Normalizes a wallet address for comparison: lowercases the scheme and host of
 * HTTP(S) URLs and removes the trailing slash(es). Payment pointers (`$host/…`)
 * only lose the trailing slash.
 */
const normalize = (value: string): string => {
  const url = /^(https?:\/\/)([^/?#]+)(.*)$/i.exec(value)
  const normalized =
    url === null
      ? value
      : `${url[1]!.toLowerCase()}${url[2]!.toLowerCase()}${url[3] ?? ''}`
  return normalized.replace(/\/+$/, '')
}

/**
 * Merchant directory port. The real directory does not exist yet (spec 009);
 * this is the hook that maps a wallet address to a merchant, used to name the
 * counterparty in the transaction list.
 */
export function createMerchantDirectoryFromEntries(
  entries: { id: string; name: string; walletAddress: string }[]
): MerchantDirectory {
  const byWallet = new Map<string, Merchant>()
  for (const entry of entries) {
    byWallet.set(normalize(entry.walletAddress), { id: entry.id, name: entry.name })
  }
  return {
    findByWallet(walletAddress) {
      return Promise.resolve(byWallet.get(normalize(walletAddress)) ?? null)
    }
  }
}

export function createEmptyMerchantDirectory(): MerchantDirectory {
  return createMerchantDirectoryFromEntries([])
}
