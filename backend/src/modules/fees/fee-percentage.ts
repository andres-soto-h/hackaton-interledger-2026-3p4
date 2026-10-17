/** A percentage between 0 and 10 with up to 3 decimal places (e.g. `1.5`, `0.001`). */
const PERCENTAGE_PATTERN = /^\d+(\.\d{1,3})?$/

const MAX_MILLI = 10_000n

/**
 * `true` when `value` is a valid fee percentage: digits with an optional
 * fraction of 1–3 decimal places, whose value is between 0 and 10 (inclusive).
 */
export function isValidFeePercentage(value: string): boolean {
  if (!PERCENTAGE_PATTERN.test(value)) return false
  const [whole = '0', fraction = ''] = value.split('.')
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
  return milli <= MAX_MILLI
}
