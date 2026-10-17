import { createPrivateKey, type KeyObject } from 'node:crypto'
import { SecretsError } from '../../config/secrets.js'

/**
 * Parses a PEM private key into an in-memory `KeyObject`. Only Ed25519 keys are
 * accepted; anything else is a configuration error. The key never touches disk
 * and never appears in error messages.
 */
export function loadPrivateKey(pem: string): KeyObject {
  try {
    const key = createPrivateKey(pem)
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('Not an Ed25519 key')
    }
    return key
  } catch {
    throw new SecretsError('Invalid Open Payments private key')
  }
}
