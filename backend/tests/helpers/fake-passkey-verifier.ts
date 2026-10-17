import {
  PasskeyVerificationError,
  type AuthenticationOptionsInput,
  type PasskeyOptions,
  type PasskeyVerifier,
  type RegistrationOptionsInput,
  type VerifiedAuthentication,
  type VerifiedRegistration,
  type VerifyAuthenticationInput,
  type VerifyRegistrationInput
} from '../../src/shared/webauthn/passkey-verifier.js'

/**
 * What the tests send as the WebAuthn `credential`: `id` is the credential id;
 * `ok: false` makes the fake reject it; `newCounter` is the signature counter.
 */
export interface FakeCredential {
  id: string
  ok?: boolean
  publicKey?: string
  newCounter?: number
}

export interface FakePasskeyVerifier extends PasskeyVerifier {
  calls: {
    registrationOptions: RegistrationOptionsInput[]
    authenticationOptions: AuthenticationOptionsInput[]
    verifyRegistration: VerifyRegistrationInput[]
    verifyAuthentication: VerifyAuthenticationInput[]
  }
}

const asFake = (credential: unknown): FakeCredential => credential as FakeCredential

/** Test double of the `PasskeyVerifier` port: no cryptography, records its calls. */
export function createFakePasskeyVerifier(): FakePasskeyVerifier {
  let counter = 0
  const calls: FakePasskeyVerifier['calls'] = {
    registrationOptions: [],
    authenticationOptions: [],
    verifyRegistration: [],
    verifyAuthentication: []
  }

  return {
    calls,

    createRegistrationOptions(input): Promise<PasskeyOptions> {
      calls.registrationOptions.push(input)
      counter += 1
      return Promise.resolve({
        challenge: `reg-challenge-${counter}`,
        rp: { id: input.rpID, name: input.rpName },
        user: { id: input.userId, name: input.userName }
      })
    },

    createAuthenticationOptions(input): Promise<PasskeyOptions> {
      calls.authenticationOptions.push(input)
      counter += 1
      return Promise.resolve({
        challenge: `login-challenge-${counter}`,
        rpId: input.rpID
      })
    },

    verifyRegistration(input): Promise<VerifiedRegistration> {
      calls.verifyRegistration.push(input)
      const credential = asFake(input.credential)
      if (credential.ok === false) {
        return Promise.reject(new PasskeyVerificationError('invalid registration'))
      }
      return Promise.resolve({
        credentialId: credential.id,
        publicKey: credential.publicKey ?? `public-key-of-${credential.id}`,
        counter: credential.newCounter ?? 0,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: true
      })
    },

    verifyAuthentication(input): Promise<VerifiedAuthentication> {
      calls.verifyAuthentication.push(input)
      const credential = asFake(input.credential)
      if (credential.ok === false) {
        return Promise.reject(new PasskeyVerificationError('invalid assertion'))
      }
      return Promise.resolve({
        credentialId: credential.id,
        newCounter: credential.newCounter ?? 0
      })
    }
  }
}
