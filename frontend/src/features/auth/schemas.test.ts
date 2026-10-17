import { displayNameSchema, normalizeWalletAddress, registerSchema } from './schemas';

describe('normalizeWalletAddress', () => {
  it.each([
    ['https://ilp.interledger-test.dev/ana', 'https://ilp.interledger-test.dev/ana'],
    ['$ilp.interledger-test.dev/ana', 'https://ilp.interledger-test.dev/ana'],
    ['  $ilp.interledger-test.dev/ana  ', 'https://ilp.interledger-test.dev/ana'],
    ['HTTPS://ILP.Interledger-Test.dev/Ana', 'https://ilp.interledger-test.dev/Ana'],
    ['https://ilp.interledger-test.dev/ana/', 'https://ilp.interledger-test.dev/ana'],
  ])('normaliza %j', (input, expected) => {
    expect(normalizeWalletAddress(input)).toBe(expected);
  });

  it.each([
    'http://ilp.interledger-test.dev/ana',
    'ilp.interledger-test.dev/ana',
    'https://',
    'https://ilp.interledger-test.dev',
    'https://ilp.interledger-test.dev/',
    '$',
    '',
    '   ',
    'https://usuario:clave@ilp.interledger-test.dev/ana',
    'https://ilp.interledger-test.dev/ana?x=1',
    'ftp://ilp.interledger-test.dev/ana',
  ])('rechaza %j', (input) => {
    expect(normalizeWalletAddress(input)).toBeNull();
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
  it('devuelve el nombre recortado y la wallet normalizada', () => {
    const parsed = registerSchema.parse({
      displayName: '  Ana  ',
      walletAddress: '$ilp.interledger-test.dev/ana',
    });
    expect(parsed).toEqual({
      displayName: 'Ana',
      walletAddress: 'https://ilp.interledger-test.dev/ana',
    });
  });

  it('reporta error por campo', () => {
    const result = registerSchema.safeParse({ displayName: '', walletAddress: 'http://x.dev/a' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(expect.arrayContaining(['displayName', 'walletAddress']));
    }
  });
});
