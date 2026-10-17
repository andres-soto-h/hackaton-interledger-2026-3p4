import { filterMerchants } from '@/features/merchants/search';
import { MOCK_MERCHANTS } from '@/features/merchants/mock-merchants';
import { ApiError } from '@/api/client';
import { parseAmountInput } from './amount';
import { GENERIC_PAYMENT_ERROR, paymentErrorMessage } from './errors';
import { buildValidationSteps, hasBlockingError } from './verify';

const epm = MOCK_MERCHANTS[0];

describe('búsqueda de comercios', () => {
  it.each(['epm', 'EPM', 'Épm', ' epm '])('"%s" encuentra EPM', (q) => {
    expect(filterMerchants(MOCK_MERCHANTS, q).map((m) => m.id)).toEqual(['mer_epm']);
  });

  it('filtra por categoría y nombre a la vez', () => {
    expect(filterMerchants(MOCK_MERCHANTS, '', 'celular').map((m) => m.id)).toEqual(['mer_claro', 'mer_movistar']);
    expect(filterMerchants(MOCK_MERCHANTS, 'claro', 'agua')).toEqual([]);
  });

  it('todos los comercios del directorio son COP', () => {
    expect(MOCK_MERCHANTS.every((m) => m.assetCode === 'COP')).toBe(true);
  });
});

describe('parseAmountInput (COP, escala 2)', () => {
  it.each([
    ['86400', '86400.00'],
    ['86.400', '86400.00'],
    ['86.400,50', '86400.50'],
    ['86400,5', '86400.50'],
    ['1.250.000', '1250000.00'],
    ['0,01', '0.01'],
    ['86400.25', '86400.25'],
    ['007', '7.00'],
  ])('%s → %s', (input, expected) => {
    expect(parseAmountInput(input, 2)).toEqual({ ok: true, value: expected });
  });

  it.each(['', '  ', '0', '0,00', '-5', 'abc', '1e3', '1,234', '1,2,3', '12a', '$5'])(
    'rechaza %j',
    (input) => {
      expect(parseAmountInput(input, 2).ok).toBe(false);
    },
  );

  it('con escala 0 no admite decimales', () => {
    expect(parseAmountInput('100', 0)).toEqual({ ok: true, value: '100' });
    expect(parseAmountInput('100,5', 0).ok).toBe(false);
  });
});

describe('pasos de validación', () => {
  const good = { exists: true, publicName: 'EPM', assetCode: 'COP', assetScale: 2 };

  it('todo correcto → todos ok', () => {
    const steps = buildValidationSteps(epm, good);
    expect(steps.every((s) => s.status === 'ok')).toBe(true);
    expect(hasBlockingError(steps)).toBe(false);
  });

  it('wallet inexistente → error que bloquea', () => {
    const steps = buildValidationSteps(epm, { exists: false, publicName: null });
    expect(steps.find((s) => s.id === 'exists')?.status).toBe('error');
    expect(hasBlockingError(steps)).toBe(true);
  });

  it('nombre distinto → advertencia que no bloquea, con el nombre que dice la wallet', () => {
    const steps = buildValidationSteps(epm, { ...good, publicName: 'Otra Empresa' });
    const owner = steps.find((s) => s.id === 'owner');
    expect(owner?.status).toBe('warning');
    expect(owner?.detail).toBe('La wallet dice ser de Otra Empresa');
    expect(hasBlockingError(steps)).toBe(false);
  });

  it('el nombre coincide sin tildes ni mayúsculas', () => {
    const steps = buildValidationSteps(epm, { ...good, publicName: 'épm' });
    expect(steps.find((s) => s.id === 'owner')?.status).toBe('ok');
  });

  it('moneda distinta de COP → error', () => {
    const steps = buildValidationSteps(epm, { ...good, assetCode: 'USD' });
    expect(hasBlockingError(steps)).toBe(true);
  });
});

describe('paymentErrorMessage', () => {
  const err = (code: string, requestId?: string) => new ApiError({ code, message: code, status: 422, requestId });

  it.each([
    ['QUOTE_FAILED', /No pudimos calcular/],
    ['AMOUNT_EXCEEDS_LIMIT', /máximo permitido/],
    ['DAILY_LIMIT_EXCEEDED', /monto que puede pagar hoy/],
    ['WALLET_NOT_LINKED', /permiso en su wallet/],
    ['PAYMENTS_DISABLED', /en pausa/],
    ['OPEN_PAYMENTS_UNAVAILABLE', /red de pagos/],
    ['MERCHANT_CURRENCY_NOT_SUPPORTED', /pesos colombianos/],
  ])('%s tiene un mensaje claro', (code, pattern) => {
    expect(paymentErrorMessage(err(code)).message).toMatch(pattern);
  });

  it('un código desconocido es genérico y deja el requestId para soporte', () => {
    expect(paymentErrorMessage(err('RARO', 'req_9'))).toEqual({ message: GENERIC_PAYMENT_ERROR, requestId: 'req_9' });
    expect(paymentErrorMessage(new Error('x')).message).toBe(GENERIC_PAYMENT_ERROR);
  });
});
