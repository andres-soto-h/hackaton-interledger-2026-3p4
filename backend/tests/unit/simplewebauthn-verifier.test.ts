import { beforeEach, describe, expect, it } from 'vitest'
import { PasskeyVerificationError } from '../../src/shared/webauthn/passkey-verifier.js'
import { createSimpleWebAuthnVerifier } from '../../src/shared/webauthn/simplewebauthn-verifier.js'
import { caught } from '../helpers/errors.js'
import {
  createSoftwareAuthenticator,
  type SoftwareAuthenticator
} from '../helpers/software-authenticator.js'

const RP_ID = 'tranqui.example'
const ORIGIN = 'https://app.tranqui.example'
const USER_ID = 'usr_01JAAAAAAAAAAAAAAAAAAAAAAA'

// Caso 15: the real SimpleWebAuthn adapter against a software authenticator
// (ES256, "none" attestation) that produces genuine WebAuthn payloads.
describe('SimpleWebAuthn PasskeyVerifier', () => {
  const verifier = createSimpleWebAuthnVerifier()
  let authenticator: SoftwareAuthenticator

  beforeEach(() => {
    authenticator = createSoftwareAuthenticator()
  })

  const register = async () => {
    const options = await verifier.createRegistrationOptions({
      rpID: RP_ID,
      rpName: 'Tranqui',
      userId: USER_ID,
      userName: 'Alice'
    })
    const credential = authenticator.register({
      challenge: options.challenge,
      origin: ORIGIN,
      rpID: RP_ID
    })
    const verified = await verifier.verifyRegistration({
      credential,
      expectedChallenge: options.challenge,
      expectedOrigins: [ORIGIN],
      expectedRPID: RP_ID
    })
    return { options, verified }
  }

  describe('opciones', () => {
    it('de registro: challenge, rp, usuario, residentKey y userVerification requeridos, sin attestation', async () => {
      const options = await verifier.createRegistrationOptions({
        rpID: RP_ID,
        rpName: 'Tranqui',
        userId: USER_ID,
        userName: 'Alice'
      })
      expect(options.challenge.length).toBeGreaterThanOrEqual(32)
      expect(options).toMatchObject({
        rp: { id: RP_ID, name: 'Tranqui' },
        user: { name: 'Alice' },
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
      })
      const user = options.user as { id: string }
      expect(Buffer.from(user.id, 'base64url').toString('utf8')).toBe(USER_ID)
      const algs = (options.pubKeyCredParams as { alg: number }[]).map((p) => p.alg)
      expect(algs).toEqual(expect.arrayContaining([-7, -257]))
    })

    it('de login: challenge nuevo, rpID y userVerification requerido, sin allowCredentials', async () => {
      const first = await verifier.createAuthenticationOptions({ rpID: RP_ID })
      const second = await verifier.createAuthenticationOptions({ rpID: RP_ID })
      expect(first.challenge).not.toBe(second.challenge)
      expect(first).toMatchObject({ rpId: RP_ID, userVerification: 'required' })
      expect(first.allowCredentials ?? []).toEqual([])
    })
  })

  describe('registro', () => {
    it('verifica la attestation y devuelve la credencial lista para guardar', async () => {
      const { verified } = await register()
      expect(verified).toMatchObject({
        credentialId: authenticator.credentialId,
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
        transports: ['internal']
      })
      expect(typeof verified.publicKey).toBe('string')
      expect(verified.publicKey.length).toBeGreaterThan(40)
    })

    it.each([
      ['otro challenge', { challenge: 'otro-challenge-distinto' }],
      ['otro origen', { origins: ['https://evil.example'] }],
      ['otro rpID', { rpID: 'evil.example' }]
    ])('rechaza con PasskeyVerificationError: %s', async (_name, change) => {
      const options = await verifier.createRegistrationOptions({
        rpID: RP_ID,
        rpName: 'Tranqui',
        userId: USER_ID,
        userName: 'Alice'
      })
      const credential = authenticator.register({
        challenge: options.challenge,
        origin: ORIGIN,
        rpID: RP_ID
      })
      const error = await caught(() =>
        verifier.verifyRegistration({
          credential,
          expectedChallenge: change.challenge ?? options.challenge,
          expectedOrigins: change.origins ?? [ORIGIN],
          expectedRPID: change.rpID ?? RP_ID
        })
      )
      expect(error).toBeInstanceOf(PasskeyVerificationError)
    })

    it('rechaza con PasskeyVerificationError una credencial malformada', async () => {
      const error = await caught(() =>
        verifier.verifyRegistration({
          credential: { id: 'x', response: {} },
          expectedChallenge: 'c',
          expectedOrigins: [ORIGIN],
          expectedRPID: RP_ID
        })
      )
      expect(error).toBeInstanceOf(PasskeyVerificationError)
    })
  })

  describe('login', () => {
    const login = async (
      stored: { publicKey: string; counter: number },
      overrides: { counter?: number; origin?: string; challenge?: string } = {}
    ) => {
      const options = await verifier.createAuthenticationOptions({ rpID: RP_ID })
      const credential = authenticator.authenticate({
        challenge: options.challenge,
        origin: ORIGIN,
        rpID: RP_ID,
        counter: overrides.counter ?? stored.counter + 1
      })
      return verifier.verifyAuthentication({
        credential,
        expectedChallenge: overrides.challenge ?? options.challenge,
        expectedOrigins: [overrides.origin ?? ORIGIN],
        expectedRPID: RP_ID,
        stored: { publicKey: stored.publicKey, counter: stored.counter }
      })
    }

    it('verifica la firma y devuelve el contador nuevo', async () => {
      const { verified } = await register()
      const result = await login(
        { publicKey: verified.publicKey, counter: 0 },
        { counter: 5 }
      )
      expect(result).toEqual({ credentialId: authenticator.credentialId, newCounter: 5 })
    })

    it('rechaza un contador que no avanza (passkey clonado)', async () => {
      const { verified } = await register()
      const error = await caught(() =>
        login({ publicKey: verified.publicKey, counter: 5 }, { counter: 5 })
      )
      expect(error).toBeInstanceOf(PasskeyVerificationError)
    })

    it('rechaza con PasskeyVerificationError otro challenge u otro origen', async () => {
      const { verified } = await register()
      const stored = { publicKey: verified.publicKey, counter: 0 }
      expect(await caught(() => login(stored, { challenge: 'otro' }))).toBeInstanceOf(
        PasskeyVerificationError
      )
      expect(
        await caught(() => login(stored, { origin: 'https://evil.example' }))
      ).toBeInstanceOf(PasskeyVerificationError)
    })

    it('rechaza con PasskeyVerificationError una firma de otra llave', async () => {
      const { verified } = await register()
      const other = createSoftwareAuthenticator('cred-software-2')
      const options = await verifier.createAuthenticationOptions({ rpID: RP_ID })
      const forged = other.authenticate({
        challenge: options.challenge,
        origin: ORIGIN,
        rpID: RP_ID,
        counter: 3
      }) as { id: string; rawId: string }
      forged.id = authenticator.credentialId
      forged.rawId = authenticator.credentialId
      const error = await caught(() =>
        verifier.verifyAuthentication({
          credential: forged,
          expectedChallenge: options.challenge,
          expectedOrigins: [ORIGIN],
          expectedRPID: RP_ID,
          stored: { publicKey: verified.publicKey, counter: 0 }
        })
      )
      expect(error).toBeInstanceOf(PasskeyVerificationError)
    })
  })
})
