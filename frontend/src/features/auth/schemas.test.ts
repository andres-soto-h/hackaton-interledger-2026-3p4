import { displayNameSchema, normalizeWalletName, registerSchema } from './schemas';

describe('normalizeWalletName', () => {
  it.each([
    ['claudia', 'claudia'],
    ['  claudia  ', 'claudia'],
    ['ana.maria', 'ana.maria'],
    ['ana_maria', 'ana_maria'],
    ['mi-wallet-123', 'mi-wallet-123'],
  ])('normaliza %j', (input, expected) => {
    expect(normalizeWalletName(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'ana maria',
    'claudia/perez',
    'https://ilp.interledger-test.dev/claudia',
    '$ilp.interledger-test.dev/claudia',
    'ilp.interledger-test.dev/claudia',
    'claudia?x=1',
    'claudia#frag',
    'usuario:clave',
    'https://',
  ])('rechaza %j', (input) => {
    expect(normalizeWalletName(input)).toBeNull();
  });
});

describe('displayNameSchema', () => {
  it.each(['Ana', '  Ana María  ', 'Jo'])('acepta %j', (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(['', ' ', 'A', '   A  ', 'x'.repeat(61)])('rechaza %j', (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('devuelve el nombre, el correo y el nombre de la wallet recortados', () => {
    const parsed = registerSchema.parse({
      displayName: '  Ana  ',
      email: 'ana@example.com',
      walletName: '  ana  ',
    });
    expect(parsed).toEqual({ displayName: 'Ana', email: 'ana@example.com', walletName: 'ana' });
  });

  it('reporta error por campo', () => {
    const result = registerSchema.safeParse({
      displayName: '',
      email: 'no-es-correo',
      walletName: 'https://x.dev/a',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(expect.arrayContaining(['displayName', 'email', 'walletName']));
    }
  });
});
