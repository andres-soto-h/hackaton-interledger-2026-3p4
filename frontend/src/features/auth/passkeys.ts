import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export class PasskeyCancelled extends Error {
  constructor() {
    super('El usuario canceló el diálogo del passkey');
    this.name = 'PasskeyCancelled';
  }
}

export class PasskeyUnsupported extends Error {
  constructor() {
    super('Este navegador no soporta passkeys');
    this.name = 'PasskeyUnsupported';
  }
}

export class PasskeyAlreadyRegistered extends Error {
  constructor() {
    super('Este dispositivo ya tiene un passkey para esta cuenta');
    this.name = 'PasskeyAlreadyRegistered';
  }
}

/** Opciones tal como las manda el backend (lo demás, como `challengeId`, no va al navegador). */
export type CreationOptions = PublicKeyCredentialCreationOptionsJSON;
export type RequestOptions = PublicKeyCredentialRequestOptionsJSON;

export interface PasskeyService {
  isSupported(): Promise<boolean>;
  create(options: CreationOptions): Promise<RegistrationResponseJSON>;
  authenticate(options: RequestOptions): Promise<AuthenticationResponseJSON>;
}

type Deps = {
  startRegistration: typeof startRegistration;
  startAuthentication: typeof startAuthentication;
  browserSupportsWebAuthn: () => boolean;
};

function translate(error: unknown): unknown {
  const e = error as { name?: string; code?: string } | null;
  if (e?.name === 'NotAllowedError' || e?.code === 'ERROR_CEREMONY_ABORTED') {
    return new PasskeyCancelled();
  }
  if (e?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return new PasskeyAlreadyRegistered();
  return error;
}

export function createPasskeyService(
  deps: Deps = { startRegistration, startAuthentication, browserSupportsWebAuthn },
): PasskeyService {
  const guard = () => {
    if (!deps.browserSupportsWebAuthn()) throw new PasskeyUnsupported();
  };
  return {
    isSupported: async () => deps.browserSupportsWebAuthn(),
    create: async (options) => {
      guard();
      try {
        return await deps.startRegistration({ optionsJSON: options });
      } catch (error) {
        throw translate(error);
      }
    },
    authenticate: async (options) => {
      guard();
      try {
        return await deps.startAuthentication({ optionsJSON: options });
      } catch (error) {
        throw translate(error);
      }
    },
  };
}
