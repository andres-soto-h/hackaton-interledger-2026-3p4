import { AppError } from '../errors/app-error.js'
import type { Amount, FixedAmountSide } from './types.js'

/** Amounts are decimal strings; conversion and comparison use integers only. */
const invalidAmount = (): AppError =>
  new AppError(400, 'VALIDATION_ERROR', 'Invalid amount')

const amountPattern = /^\d+(\.\d+)?$/

function assertValidAmount(value: string, scale: number): void {
  if (!amountPattern.test(value)) throw invalidAmount()
  const fraction = value.split('.')[1]
  if (fraction !== undefined && fraction.length > scale) throw invalidAmount()
  if (!/[1-9]/.test(value)) throw invalidAmount()
}

/**
 * Converts a decimal string to its minor units (integer string). Only `BigInt`
 * arithmetic is used; `Number`, `parseFloat` and `toFixed` are never involved.
 */
export function toMinorUnits(value: string, scale: number): string {
  assertValidAmount(value, scale)
  const [whole = '0', fraction = ''] = value.split('.')
  const scaleFactor = 10n ** BigInt(scale)
  const minor =
    BigInt(whole) * scaleFactor +
    BigInt(fraction.length > 0 ? fraction.padEnd(scale, '0') : '0')
  return minor.toString()
}

/** Converts minor units back to a decimal string with exactly `scale` decimals. */
export function fromMinorUnits(minor: string, scale: number): string {
  const value = BigInt(minor)
  if (scale === 0) return value.toString()
  const digits = value.toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, -scale)
  const fraction = digits.slice(-scale)
  return `${whole}.${fraction}`
}

/**
 * Decides which side of a payment keeps the exact requested amount (spec 003).
 * If both parties share the currency, the receiver gets the exact amount.
 */
export function resolveFixedAmount(
  amount: Amount,
  sender: { assetCode: string },
  receiver: { assetCode: string }
): FixedAmountSide {
  if (amount.assetCode === receiver.assetCode) return 'receive'
  if (amount.assetCode === sender.assetCode) return 'send'
  throw new AppError(422, 'ASSET_MISMATCH', 'Asset does not match sender or receiver')
}

/** Compares two decimal strings exactly, returning -1, 0 or 1. */
function compareDecimals(a: string, b: string): number {
  const [aWhole = '0', aFraction = ''] = a.split('.')
  const [bWhole = '0', bFraction = ''] = b.split('.')
  const scale = Math.max(aFraction.length, bFraction.length)
  const scaleFactor = 10n ** BigInt(scale)
  const aMinor =
    BigInt(aWhole) * scaleFactor +
    BigInt(aFraction.length > 0 ? aFraction.padEnd(scale, '0') : '0')
  const bMinor =
    BigInt(bWhole) * scaleFactor +
    BigInt(bFraction.length > 0 ? bFraction.padEnd(scale, '0') : '0')
  if (aMinor < bMinor) return -1
  if (aMinor > bMinor) return 1
  return 0
}

/** Rejects amounts over their currency limit, or currencies without a limit. */
export function assertWithinLimit(
  amount: Amount,
  maxAmounts: Readonly<Record<string, string>>
): void {
  const limit = maxAmounts[amount.assetCode]
  if (limit === undefined) {
    throw new AppError(422, 'CURRENCY_NOT_SUPPORTED', 'Currency is not supported')
  }
  if (compareDecimals(amount.value, limit) > 0) {
    throw new AppError(422, 'AMOUNT_EXCEEDS_LIMIT', 'Amount exceeds the currency limit')
  }
}

/** Parses a decimal string into a rational `[numerator, denominator]`. */
function toFraction(value: string): [bigint, bigint] {
  const [whole = '0', fraction = ''] = value.split('.')
  const denominator = 10n ** BigInt(fraction.length)
  const numerator =
    BigInt(whole) * denominator + BigInt(fraction.length > 0 ? fraction : '0')
  return [numerator, denominator]
}

/**
 * Exchange rate `receive / debit`, rounded half-up to exactly 6 decimal places,
 * computed with integers only (the decimal places of each string are the scale).
 */
export function exchangeRate(debit: Amount, receive: Amount): string {
  const [receiveNum, receiveDen] = toFraction(receive.value)
  const [debitNum, debitDen] = toFraction(debit.value)

  // rate = (receiveNum / receiveDen) / (debitNum / debitDen)
  const numerator = receiveNum * debitDen
  const denominator = receiveDen * debitNum

  const scaleFactor = 10n ** 6n
  const scaled = (2n * numerator * scaleFactor + denominator) / (2n * denominator)

  const whole = scaled / scaleFactor
  const fraction = (scaled % scaleFactor).toString().padStart(6, '0')
  return `${whole}.${fraction}`
}
