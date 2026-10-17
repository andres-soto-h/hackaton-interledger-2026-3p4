import type { FeeCalculator } from '../payments/fee.js'
import { calculateFee } from './calculate-fee.js'

/**
 * Real `FeeCalculator` (spec 024): computes the fee from the configured
 * percentage (read via the injected provider) and the debit amount.
 */
export function createFeeCalculator({
  percentage
}: {
  percentage: () => Promise<string>
}): FeeCalculator {
  return {
    calculate: async (debit, assetScale) => {
      const current = await percentage()
      return calculateFee(debit, assetScale, current)
    }
  }
}
