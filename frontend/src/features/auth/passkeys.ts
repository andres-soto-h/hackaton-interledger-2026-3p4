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

/**
 * El backend responde `{ challengeId, options: {...} }` (OpenAPI `ChallengeOptions`); la app trabaja
 * con las opciones planas más `challengeId`. Acepta también la forma plana (mock local).
 */
export function flattenChallenge<T extends object>(raw: unknown): T & { challengeId: string } {
  const body = raw as { challengeId: string; options?: object };
  if (body.options && typeof body.options === 'object') {
    return { ...body.options, challengeId: body.challengeId } as T & { challengeId: string };
  }
  return raw as T & { challengeId: string };
}

export interface PasskeyService {
  isSupported(): Promise<boolean>;
  create(options: CreationOptions): Promise<RegistrationResponseJSON>;
  authenticate(options: RequestOptions): Promise<AuthenticationResponseJSON>;
}

/**
 * When `EXPO_PUBLIC_PASSKEY_BYPASS=true`, the app never calls WebAuthn: register,
 * login and payment confirmation all simulate a successful passkey.
 */
export function isPasskeyBypassEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PASSKEY_BYPASS === 'true';
}

/** Service that fakes passkeys (no WebAuthn, no device prompt) for local testing. */
export function createBypassPasskeyService(): PasskeyService {
  const credential = { id: 'passkey_bypass', rawId: 'passkey_bypass', type: 'public-key' };
  return {
    isSupported: async () => true,
    create: async () => credential as unknown as RegistrationResponseJSON,
    authenticate: async () => credential as unknown as AuthenticationResponseJSON,
  };
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
        // `hints` (L3) is not supported by every browser; drop it to be safe.
        const { hints, ...withoutHints } = options as CreationOptions & { hints?: unknown };
        return await deps.startRegistration({ optionsJSON: withoutHints });
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
