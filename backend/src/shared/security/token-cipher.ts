import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const IV_LENGTH = 12
const TAG_LENGTH = 16

export interface TokenCipher {
  encrypt(plaintext: string, linkId: string): string
  decrypt(ciphertext: string, linkId: string): string
}

/**
 * AES-256-GCM cipher for wallet-link access tokens (spec 023). The AES key is
 * derived with SHA-256 from the raw secret (which is a random string, not a
 * 32-byte key). The `linkId` is bound as additional authenticated data, so a
 * token copied to another link cannot be decrypted.
 */
export function createTokenCipher(secret: string): TokenCipher {
  if (secret.length === 0) {
    throw new Error('Token encryption secret must not be empty')
  }
  const key = createHash('sha256').update(secret).digest()

  return {
    encrypt(plaintext, linkId) {
      const iv = randomBytes(IV_LENGTH)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(linkId, 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return Buffer.concat([iv, tag, ciphertext]).toString('base64')
    },

    decrypt(ciphertext, linkId) {
      const raw = Buffer.from(ciphertext, 'base64')
      if (raw.length < IV_LENGTH + TAG_LENGTH) {
        throw new Error('Ciphertext too short')
      }
      const iv = raw.subarray(0, IV_LENGTH)
      const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
      const data = raw.subarray(IV_LENGTH + TAG_LENGTH)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(Buffer.from(linkId, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    }
  }
}
