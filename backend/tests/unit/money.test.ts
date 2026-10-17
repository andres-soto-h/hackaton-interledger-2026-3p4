import { describe, expect, it } from 'vitest'
import {
  assertWithinLimit,
  exchangeRate,
  fromMinorUnits,
  resolveFixedAmount,
  toMinorUnits
} from '../../src/shared/money/money.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import { caught } from '../helpers/errors.js'

const amount = (value: string, assetCode: string) => ({ value, assetCode })

describe('money', () => {
  // Caso 1
  describe('toMinorUnits / fromMinorUnits', () => {
    it.each([
      ['10.50', 2, '1050'],
      ['10.5', 2, '1050'],
      ['1000', 2, '100000'],
      ['0.05', 2, '5'],
      ['7', 0, '7'],
      ['0.000000001', 9, '1'],
      ['123.456789012', 9, '123456789012'],
      // Beyond Number.MAX_SAFE_INTEGER: only exact with integer arithmetic.
      ['90071992547409931.23', 2, '9007199254740993123']
    ])('toMinorUnits(%s, %i) = %s', (value, scale, minor) => {
      expect(toMinorUnits(value, scale)).toBe(minor)
    })

    it.each([
      ['1050', 2, '10.50'],
      ['5', 2, '0.05'],
      ['100000', 2, '1000.00'],
      ['7', 0, '7'],
      ['1', 9, '0.000000001'],
      ['9007199254740993123', 2, '90071992547409931.23']
    ])('fromMinorUnits(%s, %i) = %s', (minor, scale, value) => {
      expect(fromMinorUnits(minor, scale)).toBe(value)
    })

    it('es exacto en ida y vuelta', () => {
      for (const [value, scale] of [
        ['10.50', 2],
        ['0.01', 2],
        ['42', 0],
        ['1.000000001', 9]
      ] as const) {
        expect(fromMinorUnits(toMinorUnits(value, scale), scale)).toBe(value)
      }
    })
  })

  // Caso 2
  it.each([
    ['0', 2],
    ['0.00', 2],
    ['-1', 2],
    ['1.234', 2],
    ['1.5', 0],
    ['1e3', 2],
    ['abc', 2],
    ['', 2],
    [' 1', 2],
    ['1.', 2],
    ['.5', 2],
    ['0x10', 2]
  ])('rechaza el monto %j con scale %i', async (value, scale) => {
    const error = await caught(() => toMinorUnits(value, scale))
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
  })

  // Caso 3
  describe('resolveFixedAmount', () => {
    const usd = { assetCode: 'USD' }
    const mxn = { assetCode: 'MXN' }

    it('fija lo que recibe el receptor si el monto está en su moneda', () => {
      expect(resolveFixedAmount(amount('200', 'MXN'), usd, mxn)).toBe('receive')
    })

    it('fija lo que envía el emisor si el monto solo está en su moneda', () => {
      expect(resolveFixedAmount(amount('10', 'USD'), usd, mxn)).toBe('send')
    })

    it('fija lo que recibe el receptor si ambos usan la misma moneda', () => {
      expect(resolveFixedAmount(amount('10', 'USD'), usd, usd)).toBe('receive')
    })

    it('rechaza una moneda que no es de ninguno', async () => {
      const error = await caught(() => resolveFixedAmount(amount('10', 'EUR'), usd, mxn))
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ status: 422, code: 'ASSET_MISMATCH' })
    })
  })

  // Caso 4
  describe('assertWithinLimit', () => {
    const limits = { USD: '1000', MXN: '20000.50' }

    it('acepta montos dentro del límite o iguales a él', () => {
      expect(() => assertWithinLimit(amount('999.99', 'USD'), limits)).not.toThrow()
      expect(() => assertWithinLimit(amount('1000.00', 'USD'), limits)).not.toThrow()
      expect(() => assertWithinLimit(amount('20000.5', 'MXN'), limits)).not.toThrow()
    })

    it('rechaza montos sobre el límite de su moneda', async () => {
      const error = await caught(() =>
        assertWithinLimit(amount('1000.01', 'USD'), limits)
      )
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ status: 422, code: 'AMOUNT_EXCEEDS_LIMIT' })
    })

    it('compara con enteros, sin errores de punto flotante', async () => {
      const big = { USD: '90071992547409931.22' }
      const error = await caught(() =>
        assertWithinLimit(amount('90071992547409931.23', 'USD'), big)
      )
      expect(error).toMatchObject({ code: 'AMOUNT_EXCEEDS_LIMIT' })
    })

    it('rechaza monedas sin límite configurado', async () => {
      const error = await caught(() => assertWithinLimit(amount('1', 'EUR'), limits))
      expect(error).toBeInstanceOf(AppError)
      expect(error).toMatchObject({ status: 422, code: 'CURRENCY_NOT_SUPPORTED' })
    })
  })

  // Caso 16
  describe('exchangeRate', () => {
    it.each([
      [amount('10.00', 'USD'), amount('172.50', 'MXN'), '17.250000'],
      [amount('10.00', 'USD'), amount('1500', 'JPY'), '150.000000'],
      [amount('1500', 'JPY'), amount('10.00', 'USD'), '0.006667'],
      [amount('3.00', 'USD'), amount('1.00', 'USD'), '0.333333'],
      [amount('3.00', 'USD'), amount('2.00', 'USD'), '0.666667'],
      [
        amount('90071992547409931.00', 'USD'),
        amount('90071992547409931.00', 'EUR'),
        '1.000000'
      ]
    ])('receive / debit con %o y %o = %s', (debit, receive, rate) => {
      expect(exchangeRate(debit, receive)).toBe(rate)
    })
  })
})
