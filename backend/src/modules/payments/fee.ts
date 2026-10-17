import type { Amount } from '../../shared/money/types.js'
import type { Payment } from './payment.types.js'

/**
 * Port of the transaction fee (spec 024). The calculation returns the fee
 * percentage, the fee amount and the total to debit (debit + fee), all in the
 * debit amount's currency. The real implementation arrives with spec 024; until
 * then the zero-fee calculator keeps payments fee-free.
 */
export interface FeeCalculator {
  calculate(
    debit: Amount
  ): Promise<{ percentage: string; fee: Amount; totalDebit: Amount }>
}

/** Port of the fee settlement (spec 024). Its failure never affects the payment. */
export interface FeeCollector {
  collect: (payment: Payment) => Promise<void>
}

/** Default calculator: no fee, the total equals the debit amount. */
export const createZeroFeeCalculator = (): FeeCalculator => ({
  calculate: (debit) =>
    Promise.resolve({
      percentage: '0',
      fee: { value: '0', assetCode: debit.assetCode },
      totalDebit: { value: debit.value, assetCode: debit.assetCode }
    })
})

/** Default collector: no-op. */
export const createNoopFeeCollector = (): FeeCollector => ({
  collect: () => Promise.resolve()
})
