import { formatMoney, toSpokenAmount } from './money';

describe('formatMoney', () => {
  it.each([
    [{ value: '86400.00', assetCode: 'COP' }, '$86.400'],
    [{ value: '86400.50', assetCode: 'COP' }, '$86.400,50'],
    [{ value: '1250000', assetCode: 'COP' }, '$1.250.000'],
    [{ value: '20.00', assetCode: 'USD' }, 'US$20,00'],
    [{ value: '25.4', assetCode: 'USD' }, 'US$25,40'],
    [{ value: '430.00', assetCode: 'MXN' }, 'MXN 430,00'],
    [{ value: '0.00', assetCode: 'COP' }, '$0'],
    [{ value: '0.38', assetCode: 'USD' }, 'US$0,38'],
    [{ value: '1000000.00', assetCode: 'USD' }, 'US$1.000.000,00'],
  ])('formatea %j como %s', (amount, expected) => {
    expect(formatMoney(amount)).toBe(expected);
  });

  it('no pierde precisión en cantidades enormes (no usa Number)', () => {
    expect(formatMoney({ value: '9007199254740993.00', assetCode: 'COP' })).toBe(
      '$9.007.199.254.740.993',
    );
  });

  it.each(['1e3', 'abc', '', '-5', '1,5', '1.2.3', ' 10', '.5'])(
    'lanza error con value inválido %j',
    (value) => {
      expect(() => formatMoney({ value, assetCode: 'COP' })).toThrow();
    },
  );

  it('lanza error con moneda vacía', () => {
    expect(() => formatMoney({ value: '10', assetCode: '' })).toThrow();
  });
});

describe('toSpokenAmount', () => {
  it.each([
    [{ value: '86400.00', assetCode: 'COP' }, 'ochenta y seis mil cuatrocientos pesos'],
    [{ value: '20.00', assetCode: 'USD' }, 'veinte dólares'],
    [{ value: '1.00', assetCode: 'COP' }, 'un peso'],
    [{ value: '1.00', assetCode: 'USD' }, 'un dólar'],
    [{ value: '21000', assetCode: 'COP' }, 'veintiún mil pesos'],
    [{ value: '1000', assetCode: 'COP' }, 'mil pesos'],
    [{ value: '101', assetCode: 'COP' }, 'ciento un pesos'],
    [{ value: '100', assetCode: 'COP' }, 'cien pesos'],
    [{ value: '1000000', assetCode: 'COP' }, 'un millón de pesos'],
    [{ value: '2500000', assetCode: 'COP' }, 'dos millones quinientos mil pesos'],
    [{ value: '0', assetCode: 'COP' }, 'cero pesos'],
    [{ value: '25.50', assetCode: 'USD' }, 'veinticinco dólares con cincuenta centavos'],
    [{ value: '0.38', assetCode: 'USD' }, 'cero dólares con treinta y ocho centavos'],
    [{ value: '430.00', assetCode: 'MXN' }, 'cuatrocientos treinta MXN'],
  ])('dice %j como "%s"', (amount, expected) => {
    expect(toSpokenAmount(amount)).toBe(expected);
  });

  it('lanza error con value inválido', () => {
    expect(() => toSpokenAmount({ value: 'abc', assetCode: 'COP' })).toThrow();
  });
});

describe('toSpokenAmount con millones', () => {
  it.each([
    ['1000000000', 'mil millones de pesos'],
    ['2500000000', 'dos mil quinientos millones de pesos'],
    ['21000000', 'veintiún millones de pesos'],
  ])('dice %s', (value, expected) => {
    expect(toSpokenAmount({ value, assetCode: 'COP' })).toBe(expected);
  });
});
