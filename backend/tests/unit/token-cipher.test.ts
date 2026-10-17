import { describe, expect, it } from 'vitest'
import { createTokenCipher } from '../../src/shared/security/token-cipher.js'

const SECRET = 'a'.repeat(64)

// Caso 7
describe('createTokenCipher', () => {
  it('recupera el texto original (ida y vuelta)', () => {
    const cipher = createTokenCipher(SECRET)
    const ciphertext = cipher.encrypt('{"accessToken":"tok-123"}', 'wl_1')
    expect(ciphertext).not.toContain('tok-123')
    expect(cipher.decrypt(ciphertext, 'wl_1')).toBe('{"accessToken":"tok-123"}')
  })

  it('produce un texto cifrado distinto cada vez (IV aleatorio)', () => {
    const cipher = createTokenCipher(SECRET)
    expect(cipher.encrypt('same', 'wl_1')).not.toBe(cipher.encrypt('same', 'wl_1'))
  })

  it('falla al descifrar con otro linkId', () => {
    const cipher = createTokenCipher(SECRET)
    const ciphertext = cipher.encrypt('tok', 'wl_1')
    expect(() => cipher.decrypt(ciphertext, 'wl_2')).toThrow()
  })

  it('falla si el texto cifrado fue alterado', () => {
    const cipher = createTokenCipher(SECRET)
    const bytes = Buffer.from(cipher.encrypt('tok', 'wl_1'), 'base64')
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
    expect(() => cipher.decrypt(bytes.toString('base64'), 'wl_1')).toThrow()
  })

  it('falla con otro secreto', () => {
    const ciphertext = createTokenCipher(SECRET).encrypt('tok', 'wl_1')
    expect(() => createTokenCipher('b'.repeat(64)).decrypt(ciphertext, 'wl_1')).toThrow()
  })

  it('rechaza un texto cifrado demasiado corto', () => {
    expect(() => createTokenCipher(SECRET).decrypt('AAAA', 'wl_1')).toThrow()
  })

  it('rechaza un secreto vacío', () => {
    expect(() => createTokenCipher('')).toThrow()
  })
})
