import { createHash, timingSafeEqual } from 'node:crypto'

export interface CallbackHashInput {
  clientNonce: string
  finishNonce: string
  interactRef: string
  authServerUrl: string
}

/** `base64(sha256(clientNonce \n finishNonce \n interactRef \n authServerUrl))`. */
export function computeCallbackHash(input: CallbackHashInput): string {
  const payload = [
    input.clientNonce,
    input.finishNonce,
    input.interactRef,
    input.authServerUrl
  ].join('\n')
  return createHash('sha256').update(payload).digest('base64')
}

/**
 * Constant-time comparison of the received hash. Never throws: mismatched
 * lengths (or anything else) simply return `false`.
 */
export function verifyCallbackHash(input: CallbackHashInput, received: string): boolean {
  const expected = Buffer.from(computeCallbackHash(input))
  const actual = Buffer.from(received)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
