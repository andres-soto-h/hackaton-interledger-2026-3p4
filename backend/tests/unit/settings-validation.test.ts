import { describe, expect, it } from 'vitest'
import { parseSettingsForm } from '../../src/modules/admin/settings-validation.js'

const valid = {
  walletProviderBaseUrl: 'https://wallet.new.test',
  allowedWalletHosts: 'a.test, b.test',
  maxPaymentAmounts: 'USD:1000,MXN:20000',
  dailySpendLimits: 'USD:200',
  feePercentage: '2.5',
  linkAuthTtlSeconds: '600',
  frontendResultUrl: 'https://app.example/result',
  paymentsEnabled: 'on'
}

const errorsOf = (input: Record<string, string | undefined>): Record<string, string> => {
  const result = parseSettingsForm(input)
  if (result.ok) throw new Error('expected validation errors')
  return result.errors
}

describe('parseSettingsForm', () => {
  it('convierte un formulario válido a la configuración editable', () => {
    const result = parseSettingsForm(valid)
    expect(result).toEqual({
      ok: true,
      values: {
        walletProviderBaseUrl: 'https://wallet.new.test',
        allowedWalletHosts: ['a.test', 'b.test'],
        maxPaymentAmounts: { USD: '1000', MXN: '20000' },
        dailySpendLimits: { USD: '200' },
        feePercentage: '2.5',
        linkAuthTtlSeconds: 600,
        frontendResultUrl: 'https://app.example/result',
        paymentsEnabled: true
      }
    })
  })

  it('un checkbox ausente es paymentsEnabled = false; frontendResultUrl vacío es válido', () => {
    const result = parseSettingsForm({
      ...valid,
      paymentsEnabled: undefined,
      frontendResultUrl: ''
    })
    expect(result).toMatchObject({
      ok: true,
      values: { paymentsEnabled: false, frontendResultUrl: '' }
    })
  })

  // Caso 7
  it.each([
    ['http://wallet.new.test'],
    ['https://10.0.0.1'],
    ['https://192.168.1.5'],
    ['https://169.254.169.254'],
    ['https://localhost'],
    ['https://x.test:8443'],
    ['https://u:p@x.test'],
    ['https://x.test/path?q=1'],
    ['ftp://x.test'],
    ['not a url'],
    ['']
  ])('rechaza walletProviderBaseUrl %j con un mensaje en ese campo', (url) => {
    const errors = errorsOf({ ...valid, walletProviderBaseUrl: url })
    expect(Object.keys(errors)).toEqual(['walletProviderBaseUrl'])
    expect(errors.walletProviderBaseUrl).toBeTruthy()
  })

  it.each([
    ['localhost'],
    ['10.0.0.1'],
    ['https://x.test'],
    ['bad host'],
    ['a.test:8443']
  ])('rechaza allowedWalletHosts %j', (hosts) => {
    expect(Object.keys(errorsOf({ ...valid, allowedWalletHosts: hosts }))).toEqual([
      'allowedWalletHosts'
    ])
  })

  it('allowedWalletHosts vacío es válido (lista vacía)', () => {
    expect(parseSettingsForm({ ...valid, allowedWalletHosts: '' })).toMatchObject({
      ok: true,
      values: { allowedWalletHosts: [] }
    })
  })

  it.each([
    ['USD:0'],
    ['usd:5'],
    ['USD:abc'],
    ['USD'],
    ['USD:-1'],
    ['USDX:5'],
    ['USD:5,USD:6'],
    ['']
  ])('rechaza maxPaymentAmounts y dailySpendLimits %j', (value) => {
    expect(Object.keys(errorsOf({ ...valid, maxPaymentAmounts: value }))).toEqual([
      'maxPaymentAmounts'
    ])
    expect(Object.keys(errorsOf({ ...valid, dailySpendLimits: value }))).toEqual([
      'dailySpendLimits'
    ])
  })

  it.each([['0'], ['0.001'], ['2.5'], ['10']])('acepta feePercentage %j', (fee) => {
    expect(parseSettingsForm({ ...valid, feePercentage: fee }).ok).toBe(true)
  })

  it.each([['-1'], ['10.001'], ['11'], ['0.0005'], ['abc'], ['']])(
    'rechaza feePercentage %j',
    (fee) => {
      expect(Object.keys(errorsOf({ ...valid, feePercentage: fee }))).toEqual([
        'feePercentage'
      ])
    }
  )

  it.each([
    ['60', true],
    ['3600', true],
    ['59', false],
    ['3601', false],
    ['abc', false],
    ['1.5', false]
  ])('linkAuthTtlSeconds %j → válido: %s', (ttl, ok) => {
    expect(parseSettingsForm({ ...valid, linkAuthTtlSeconds: ttl }).ok).toBe(ok)
  })

  it.each([['http://app.example'], ['javascript:alert(1)'], ['app.example']])(
    'rechaza frontendResultUrl %j',
    (url) => {
      expect(Object.keys(errorsOf({ ...valid, frontendResultUrl: url }))).toEqual([
        'frontendResultUrl'
      ])
    }
  )

  it('reporta todos los campos inválidos a la vez', () => {
    const errors = errorsOf({
      ...valid,
      walletProviderBaseUrl: 'http://x',
      feePercentage: '99'
    })
    expect(Object.keys(errors).sort()).toEqual(['feePercentage', 'walletProviderBaseUrl'])
  })
})
