import { describe, expect, it } from 'vitest'
import {
  computeCallbackHash,
  verifyCallbackHash
} from '../../src/modules/wallet-links/callback-hash.js'

const input = {
  clientNonce: 'client-nonce-1',
  finishNonce: 'finish-nonce-1',
  interactRef: 'ref-1',
  authServerUrl: 'https://auth.interledger-test.dev'
}

// Caso 14: base64(sha256(clientNonce \n finishNonce \n interactRef \n authServerUrl))
const KNOWN_HASH = 'VUsQqN0U+/Ne6NMN1k4gLu5a5fJj35HiDZsI7Noxlmo='

describe('callback hash', () => {
  it('coincide con el vector conocido', () => {
    expect(computeCallbackHash(input)).toBe(KNOWN_HASH)
  })

  it('verifyCallbackHash acepta el hash correcto', () => {
    expect(verifyCallbackHash(input, KNOWN_HASH)).toBe(true)
  })

  it.each([
    ['otro nonce', { ...input, clientNonce: 'other' }],
    ['otro finish nonce', { ...input, finishNonce: 'other' }],
    ['otra referencia', { ...input, interactRef: 'ref-2' }],
    ['otro auth server', { ...input, authServerUrl: 'https://evil.example' }]
  ])('el hash cambia con %s', (_name, changed) => {
    expect(computeCallbackHash(changed)).not.toBe(KNOWN_HASH)
    expect(verifyCallbackHash(changed, KNOWN_HASH)).toBe(false)
  })

  it.each(['', 'short', KNOWN_HASH.slice(0, -2), `${KNOWN_HASH}A`])(
    'rechaza el hash recibido %j sin lanzar',
    (received) => {
      expect(verifyCallbackHash(input, received)).toBe(false)
    }
  )
})
