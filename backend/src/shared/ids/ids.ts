import { randomBytes } from 'node:crypto'

/** Crockford base32 (no I, L, O, U), uppercase. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const TIME_CHARS = 10
const RANDOM_CHARS = 16

/** Encodes the 48 timestamp bits (ms) as 10 Crockford characters. */
function encodeTime(now: number): string {
  let encoded = ''
  let value = Math.floor(now)
  for (let i = 0; i < TIME_CHARS; i++) {
    encoded = CROCKFORD[value % 32]! + encoded
    value = Math.floor(value / 32)
  }
  return encoded
}

/**
 * 80 bits of cryptographic randomness as 16 Crockford characters. Uses
 * `node:crypto` (never `Math.random`). Each byte contributes 5 unbiased bits
 * (256 % 32 === 0).
 */
function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_CHARS)
  let encoded = ''
  for (const byte of bytes) {
    encoded += CROCKFORD[byte % 32]!
  }
  return encoded
}

export type IdPrefix = 'pay' | 'pr' | 'idem'

/** `${prefix}_${ulid}`: a time-sortable ULID with a domain prefix. */
export function newId(prefix: IdPrefix, now: number = Date.now()): string {
  return `${prefix}_${encodeTime(now)}${encodeRandom()}`
}

export function newPaymentId(now?: number): string {
  return newId('pay', now)
}

export function newPaymentRequestId(now?: number): string {
  return newId('pr', now)
}
