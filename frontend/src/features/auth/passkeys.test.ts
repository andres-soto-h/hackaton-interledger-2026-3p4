import {
  createBypassPasskeyService,
  createPasskeyService,
  isPasskeyBypassEnabled,
  PasskeyAlreadyRegistered,
  PasskeyCancelled,
  PasskeyUnsupported,
} from './passkeys';

const options = { challenge: 'abc' } as never;

function namedError(name: string, code?: string) {
  const error = new Error(name) as Error & { code?: string };
  error.name = name;
  error.code = code;
  return error;
}

describe('createPasskeyService', () => {
  const ok = { id: 'cred' } as never;

  it('crea y firma pasando las opciones del backend', async () => {
    const startRegistration = jest.fn().mockResolvedValue(ok);
    const startAuthentication = jest.fn().mockResolvedValue(ok);
    const service = createPasskeyService({
      startRegistration,
      startAuthentication,
      browserSupportsWebAuthn: () => true,
    });
    expect(await service.create(options)).toBe(ok);
    expect(await service.authenticate(options)).toBe(ok);
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
  });

  it('traduce la cancelación del usuario (NotAllowedError)', async () => {
    const service = createPasskeyService({
      startRegistration: jest.fn().mockRejectedValue(namedError('NotAllowedError')),
      startAuthentication: jest.fn().mockRejectedValue(namedError('NotAllowedError')),
      browserSupportsWebAuthn: () => true,
    });
    await expect(service.authenticate(options)).rejects.toBeInstanceOf(PasskeyCancelled);
    await expect(service.create(options)).rejects.toBeInstanceOf(PasskeyCancelled);
  });

  it('traduce el passkey ya registrado', async () => {
    const service = createPasskeyService({
      startRegistration: jest
        .fn()
        .mockRejectedValue(namedError('InvalidStateError', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')),
      startAuthentication: jest.fn(),
      browserSupportsWebAuthn: () => true,
    });
    await expect(service.create(options)).rejects.toBeInstanceOf(PasskeyAlreadyRegistered);
  });

  it('lanza PasskeyUnsupported y se reporta no soportado', async () => {
    const service = createPasskeyService({
      startRegistration: jest.fn(),
      startAuthentication: jest.fn(),
      browserSupportsWebAuthn: () => false,
    });
    expect(await service.isSupported()).toBe(false);
    await expect(service.authenticate(options)).rejects.toBeInstanceOf(PasskeyUnsupported);
    await expect(service.create(options)).rejects.toBeInstanceOf(PasskeyUnsupported);
  });

  it('deja pasar los demás errores', async () => {
    const boom = new Error('otro');
    const service = createPasskeyService({
      startRegistration: jest.fn(),
      startAuthentication: jest.fn().mockRejectedValue(boom),
      browserSupportsWebAuthn: () => true,
    });
    await expect(service.authenticate(options)).rejects.toBe(boom);
  });
});

describe('bypass de passkeys', () => {
  const original = process.env.EXPO_PUBLIC_PASSKEY_BYPASS;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_PASSKEY_BYPASS;
    else process.env.EXPO_PUBLIC_PASSKEY_BYPASS = original;
  });

  it('isPasskeyBypassEnabled solo es true con "true"', () => {
    process.env.EXPO_PUBLIC_PASSKEY_BYPASS = 'true';
    expect(isPasskeyBypassEnabled()).toBe(true);
    process.env.EXPO_PUBLIC_PASSKEY_BYPASS = 'false';
    expect(isPasskeyBypassEnabled()).toBe(false);
    delete process.env.EXPO_PUBLIC_PASSKEY_BYPASS;
    expect(isPasskeyBypassEnabled()).toBe(false);
  });

  it('simula crear y autenticar sin tocar WebAuthn', async () => {
    const service = createBypassPasskeyService();
    expect(await service.isSupported()).toBe(true);

    const created = await service.create(options);
    expect(created.id).toBe('passkey_bypass');

    const authenticated = await service.authenticate(options);
    expect(authenticated.id).toBe('passkey_bypass');
  });
});
