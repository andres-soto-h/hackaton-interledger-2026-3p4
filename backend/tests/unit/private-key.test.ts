import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SecretsError } from '../../src/config/secrets.js'
import { loadPrivateKey } from '../../src/integrations/open-payments/private-key.js'
import { caught } from '../helpers/errors.js'

// Keys generated per test run: never real keys in the repo.
const pem = (type: 'ed25519' | 'rsa') =>
  (type === 'rsa'
    ? generateKeyPairSync('rsa', { modulusLength: 2048 })
    : generateKeyPairSync('ed25519')
  ).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

describe('loadPrivateKey', () => {
  it('convierte la llave Ed25519 en PEM a un KeyObject privado en memoria', () => {
    const key = loadPrivateKey(pem('ed25519'))
    expect(key.type).toBe('private')
    expect(key.asymmetricKeyType).toBe('ed25519')
  })

  // Caso 8 (llave inválida)
  it.each([
    ['texto que no es una llave', 'not-a-key'],
    ['PEM corrupto', '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----']
  ])('rechaza %s sin incluir la llave en el mensaje', async (_, value) => {
    const error = await caught(() => loadPrivateKey(value))
    expect(error).toBeInstanceOf(SecretsError)
    expect((error as Error).message).toMatch(/Invalid Open Payments private key/)
    expect((error as Error).message).not.toContain(value)
  })

  it('rechaza llaves que no son Ed25519', async () => {
    const error = await caught(() => loadPrivateKey(pem('rsa')))
    expect(error).toBeInstanceOf(SecretsError)
    expect((error as Error).message).toMatch(/Invalid Open Payments private key/)
  })
})
