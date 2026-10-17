import { fromMinorUnits } from '../../shared/money/money.js'
import type { Payment } from '../payments/payment.types.js'

export interface FeeSummary {
  /** Collected fees by currency: last 24 h and all-time totals (exact decimals). */
  byCurrency: Record<string, { last24h: string; total: string }>
  failedCount: number
}

export interface FeeSummaryProvider {
  summary(): Promise<FeeSummary>
}

const DAY_MS = 24 * 3600_000

/** Sums decimal strings exactly (normalizes each value's decimals with BigInt). */
function sumDecimals(values: string[]): string {
  const scale = values.reduce(
    (max, value) => Math.max(max, (value.split('.')[1] ?? '').length),
    0
  )
  const factor = 10n ** BigInt(scale)

  let sum = 0n
  for (const value of values) {
    const [whole = '0', fraction = ''] = value.split('.')
    sum +=
      BigInt(whole) * factor +
      BigInt(fraction.length > 0 ? fraction.padEnd(scale, '0') : '0')
  }

  return fromMinorUnits(sum.toString(), scale)
}

/**
 * Aggregates fees for the admin panel: collected fees per currency (last 24 h
 * by `createdAt`, plus all-time total) and the count of failed fee attempts.
 * Currencies with no collected fees are omitted.
 */
export function summarizeFees(payments: Payment[], nowMs: number): FeeSummary {
  const collectedByCurrency = new Map<string, { recent: string[]; all: string[] }>()
  let failedCount = 0

  for (const payment of payments) {
    if (payment.feeStatus === 'FAILED') {
      failedCount += 1
      continue
    }
    if (payment.feeStatus !== 'COLLECTED') continue

    const fee = payment.fee
    if (fee === undefined) continue

    const bucket = collectedByCurrency.get(fee.assetCode) ?? { recent: [], all: [] }
    bucket.all.push(fee.value)
    const ageMs = nowMs - Date.parse(payment.createdAt)
    if (ageMs < DAY_MS) bucket.recent.push(fee.value)
    collectedByCurrency.set(fee.assetCode, bucket)
  }

  const byCurrency: FeeSummary['byCurrency'] = {}
  for (const [assetCode, bucket] of collectedByCurrency) {
    byCurrency[assetCode] = {
      last24h: sumDecimals(bucket.recent),
      total: sumDecimals(bucket.all)
    }
  }

  return { byCurrency, failedCount }
}
