/** Options handed to the client so its authenticator can create or sign. */
export interface PasskeyOptions {
  challenge: string
  [k: string]: unknown
}

export interface RegistrationOptionsInput {
  rpID: string
  rpName: string
  userId: string
  userName: string
}

export interface AuthenticationOptionsInput {
  rpID: string
  /** Limits the ceremony to these credentials (login by email). */
  allowCredentials?: Array<{ id: string; transports?: string[] }>
}

export interface VerifyRegistrationInput {
  credential: unknown
  expectedChallenge: string
  expectedOrigins: string[]
  expectedRPID: string
}

export interface VerifiedRegistration {
  credentialId: string
  publicKey: string
  counter: number
  transports?: string[]
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
}

export interface VerifyAuthenticationInput {
  credential: unknown
  expectedChallenge: string
  expectedOrigins: string[]
  expectedRPID: string
  stored: {
    publicKey: string
    counter: number
    transports?: string[]
  }
}

export interface VerifiedAuthentication {
  credentialId: string
  newCounter: number
}

/** A WebAuthn verification failed (signature, origin, rpID or counter). */
export class PasskeyVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasskeyVerificationError'
  }
}

/**
 * Port that isolates WebAuthn cryptography. The real adapter (SimpleWebAuthn)
 * arrives in a later batch; services depend only on this port.
 */
export interface PasskeyVerifier {
  createRegistrationOptions(input: RegistrationOptionsInput): Promise<PasskeyOptions>
  createAuthenticationOptions(input: AuthenticationOptionsInput): Promise<PasskeyOptions>
  verifyRegistration(input: VerifyRegistrationInput): Promise<VerifiedRegistration>
  verifyAuthentication(input: VerifyAuthenticationInput): Promise<VerifiedAuthentication>
}
