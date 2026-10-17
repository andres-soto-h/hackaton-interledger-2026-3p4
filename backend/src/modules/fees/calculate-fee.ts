import { fromMinorUnits, toMinorUnits } from '../../shared/money/money.js'
import type { Amount } from '../../shared/money/types.js'
import { isValidFeePercentage } from './fee-percentage.js'

export interface FeeCalculation {
  percentage: string
  fee: Amount
  totalDebit: Amount
}

/** Scales a validated percentage (up to 3 decimals) to thousandths as a BigInt. */
function percentageToMilli(percentage: string): bigint {
  const [whole = '0', fraction = ''] = percentage.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}

/**
 * Fee = `ceil(debitMinor × percentage / 100)` in the debit currency's minor
 * units, computed with integer (`BigInt`) arithmetic only. The percentage has
 * up to 3 decimals, so it is scaled ×1000: `ceil(debitMinor × pct1000 / 100000)`.
 */
export function calculateFee(
  debit: Amount,
  assetScale: number,
  percentage: string
): FeeCalculation {
  if (!isValidFeePercentage(percentage)) {
    throw new Error('Invalid fee percentage')
  }

  const debitMinor = BigInt(toMinorUnits(debit.value, assetScale))
  const feeMinor = (debitMinor * percentageToMilli(percentage) + 99_999n) / 100_000n
  const totalMinor = debitMinor + feeMinor

  return {
    percentage,
    fee: {
      value: fromMinorUnits(feeMinor.toString(), assetScale),
      assetCode: debit.assetCode
    },
    totalDebit: {
      value: fromMinorUnits(totalMinor.toString(), assetScale),
      assetCode: debit.assetCode
    }
  }
}
