import { isAllowedAuthorizationUrl } from './open-url';

describe('isAllowedAuthorizationUrl', () => {
  it('acepta https siempre', () => {
    expect(isAllowedAuthorizationUrl('https://wallet.test/grant', false)).toBe(true);
  });

  it('http solo en desarrollo y solo en localhost', () => {
    expect(isAllowedAuthorizationUrl('http://localhost:3001/mock-wallet', true)).toBe(true);
    expect(isAllowedAuthorizationUrl('http://localhost:3001/mock-wallet', false)).toBe(false);
    expect(isAllowedAuthorizationUrl('http://evil.test/grant', true)).toBe(false);
    expect(isAllowedAuthorizationUrl('http://localhost.evil.test/grant', true)).toBe(false);
  });

  it.each(['', 'javascript:alert(1)', 'ftp://x.test/a', 'no es url'])('rechaza %j', (v) => {
    expect(isAllowedAuthorizationUrl(v, true)).toBe(false);
  });
});
