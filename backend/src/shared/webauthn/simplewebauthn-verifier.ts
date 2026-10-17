import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON
} from '@simplewebauthn/server'
import {
  PasskeyVerificationError,
  type PasskeyOptions,
  type PasskeyVerifier,
  type VerifiedAuthentication,
  type VerifiedRegistration
} from './passkey-verifier.js'

const FAILED = 'Passkey verification failed'

/**
 * Real WebAuthn adapter backed by `@simplewebauthn/server`. Any verification
 * failure (signature, origin, rpID or a counter that does not advance) is
 * translated to `PasskeyVerificationError`.
 */
export function createSimpleWebAuthnVerifier(): PasskeyVerifier {
  return {
    async createRegistrationOptions(input) {
      const options = await generateRegistrationOptions({
        rpID: input.rpID,
        rpName: input.rpName,
        userName: input.userName,
        userDisplayName: input.userName,
        userID: Buffer.from(input.userId, 'utf8'),
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required'
        },
        supportedAlgorithmIDs: [-7, -257]
      })
      return options as unknown as PasskeyOptions
    },

    async createAuthenticationOptions(input) {
      const options = await generateAuthenticationOptions({
        rpID: input.rpID,
        userVerification: 'required'
      })
      return options as unknown as PasskeyOptions
    },

    async verifyRegistration(input) {
      try {
        const result = await verifyRegistrationResponse({
          response: input.credential as RegistrationResponseJSON,
          expectedChallenge: input.expectedChallenge,
          expectedOrigin: input.expectedOrigins,
          expectedRPID: input.expectedRPID,
          requireUserVerification: true
        })
        if (!result.verified || result.registrationInfo === undefined) {
          throw new PasskeyVerificationError(FAILED)
        }
        const { credential, credentialDeviceType, credentialBackedUp } =
          result.registrationInfo
        const verified: VerifiedRegistration = {
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp
        }
        if (credential.transports !== undefined) {
          verified.transports = credential.transports
        }
        return verified
      } catch (error) {
        if (error instanceof PasskeyVerificationError) throw error
        throw new PasskeyVerificationError(FAILED)
      }
    },

    async verifyAuthentication(input) {
      try {
        const response = input.credential as AuthenticationResponseJSON
        const id = typeof response?.id === 'string' ? response.id : ''
        const result = await verifyAuthenticationResponse({
          response,
          expectedChallenge: input.expectedChallenge,
          expectedOrigin: input.expectedOrigins,
          expectedRPID: input.expectedRPID,
          credential: {
            id,
            publicKey: Buffer.from(input.stored.publicKey, 'base64url'),
            counter: input.stored.counter,
            ...(input.stored.transports !== undefined
              ? { transports: input.stored.transports }
              : {})
          },
          requireUserVerification: true
        })
        if (!result.verified) {
          throw new PasskeyVerificationError(FAILED)
        }
        const verified: VerifiedAuthentication = {
          credentialId: result.authenticationInfo.credentialID,
          newCounter: result.authenticationInfo.newCounter
        }
        return verified
      } catch (error) {
        if (error instanceof PasskeyVerificationError) throw error
        throw new PasskeyVerificationError(FAILED)
      }
    }
  }
}
