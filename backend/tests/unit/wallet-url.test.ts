import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/shared/errors/app-error.js'
import { assertSafeWalletUrl } from '../../src/shared/security/wallet-url.js'
import { caught } from '../helpers/errors.js'

const settings = {
  walletProviderBaseUrl: 'https://ilp.interledger-test.dev',
  allowedWalletHosts: ['wallet.example']
}

const expectNotAllowed = async (input: string, s = settings) => {
  const error = await caught(() => assertSafeWalletUrl(input, s))
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({ status: 422, code: 'WALLET_NOT_ALLOWED' })
}

describe('assertSafeWalletUrl', () => {
  // Caso 5
  it.each([
    'http://ilp.interledger-test.dev/alice',
    'ftp://ilp.interledger-test.dev/alice',
    'https://evil.example/alice',
    'https://localhost/alice',
    'https://127.0.0.1/alice',
    'https://10.0.0.1/alice',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/alice',
    'https://ilp.interledger-test.dev:8443/alice',
    'https://user:pass@ilp.interledger-test.dev/alice',
    '$localhost/alice',
    ''
  ])('rechaza %j', async (input) => {
    await expectNotAllowed(input)
  })

  it('rechaza IPs privadas y localhost aunque estén en los hosts permitidos', async () => {
    const permissive = {
      ...settings,
      allowedWalletHosts: ['localhost', '10.0.0.1', '192.168.1.10', '169.254.169.254']
    }
    for (const host of permissive.allowedWalletHosts) {
      await expectNotAllowed(`https://${host}/alice`, permissive)
    }
  })

  // Caso 6
  it.each([
    ['https://ilp.interledger-test.dev/alice', 'https://ilp.interledger-test.dev/alice'],
    ['$ilp.interledger-test.dev/alice', 'https://ilp.interledger-test.dev/alice'],
    [
      'https://ilp.interledger-test.dev:443/alice',
      'https://ilp.interledger-test.dev/alice'
    ],
    ['https://wallet.example/bob', 'https://wallet.example/bob']
  ])('acepta %j y devuelve %j', (input, expected) => {
    expect(assertSafeWalletUrl(input, settings)).toBe(expected)
  })

  // Caso 15
  it('resuelve un handle contra el proveedor de wallets', () => {
    expect(assertSafeWalletUrl('alice', settings)).toBe(
      'https://ilp.interledger-test.dev/alice'
    )
  })

  it('usa el proveedor configurado: el host nuevo queda permitido y el anterior no', async () => {
    const changed = {
      walletProviderBaseUrl: 'https://wallet.example',
      allowedWalletHosts: []
    }

    expect(assertSafeWalletUrl('alice', changed)).toBe('https://wallet.example/alice')
    expect(assertSafeWalletUrl('https://wallet.example/x', changed)).toBe(
      'https://wallet.example/x'
    )
    await expectNotAllowed('https://ilp.interledger-test.dev/x', changed)
  })

  it('rechaza handles con caracteres de ruta o de URL', async () => {
    for (const input of ['../admin', 'alice/../../x', 'alice?x=1', 'ali ce']) {
      await expectNotAllowed(input)
    }
  })
})
