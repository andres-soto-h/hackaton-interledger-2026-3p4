import { describe, expect, it } from 'vitest'
import { calculateFee } from '../../src/modules/fees/calculate-fee.js'
import { isValidFeePercentage } from '../../src/modules/fees/fee-percentage.js'

const usd = (value: string) => ({ value, assetCode: 'USD' })

// Caso 1
describe('calculateFee', () => {
  it('1,5 % de 25.07 USD → 0.38 (0,37605 redondeado hacia arriba); total 25.45', () => {
    expect(calculateFee(usd('25.07'), 2, '1.5')).toEqual({
      percentage: '1.5',
      fee: usd('0.38'),
      totalDebit: usd('25.45')
    })
  })

  it('0 % → comisión cero y total igual al débito', () => {
    expect(calculateFee(usd('25.07'), 2, '0')).toEqual({
      percentage: '0',
      fee: usd('0.00'),
      totalDebit: usd('25.07')
    })
  })

  it('0,001 % sube a la unidad mínima (0.01), nunca baja a cero por redondeo', () => {
    expect(calculateFee(usd('25.07'), 2, '0.001').fee).toEqual(usd('0.01'))
  })

  it('10 % de 25.07 → 2.51 (2,507 hacia arriba); total 27.58', () => {
    const result = calculateFee(usd('25.07'), 2, '10')
    expect(result.fee).toEqual(usd('2.51'))
    expect(result.totalDebit).toEqual(usd('27.58'))
  })

  it('un cociente exacto no se redondea: 1,5 % de 10.00 → 0.15', () => {
    expect(calculateFee(usd('10.00'), 2, '1.5').fee).toEqual(usd('0.15'))
  })

  it('scale 0 (JPY): 1,5 % de 1000 → 15 exacto; de 25 → 1 (0,375 hacia arriba)', () => {
    const jpy = (value: string) => ({ value, assetCode: 'JPY' })
    expect(calculateFee(jpy('1000'), 0, '1.5')).toEqual({
      percentage: '1.5',
      fee: jpy('15'),
      totalDebit: jpy('1015')
    })
    expect(calculateFee(jpy('25'), 0, '1.5').fee).toEqual(jpy('1'))
  })

  it('scale 9: 1,5 % de 1.000000001 → 0.015000001; total 1.015000002', () => {
    const result = calculateFee(usd('1.000000001'), 9, '1.5')
    expect(result.fee).toEqual(usd('0.015000001'))
    expect(result.totalDebit).toEqual(usd('1.015000002'))
  })

  it('un porcentaje inválido lanza un error', () => {
    expect(() => calculateFee(usd('10.00'), 2, '10.5')).toThrow()
    expect(() => calculateFee(usd('10.00'), 2, 'abc')).toThrow()
  })
})

// Caso 2
describe('isValidFeePercentage', () => {
  it.each(['0', '1.5', '0.001', '10', '10.000', '7', '0.0'])('acepta %j', (value) => {
    expect(isValidFeePercentage(value)).toBe(true)
  })

  it.each(['-1', '10.5', '10.001', '1.2345', 'abc', '', ' 1', '1e1', '.5', '1.', '1,5'])(
    'rechaza %j',
    (value) => {
      expect(isValidFeePercentage(value)).toBe(false)
    }
  )
})
