import { screen, fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '../../../tests/utils/render';
import { makeTransaction } from '../../../tests/msw/transactions';
import { TransactionItem } from './components/TransactionItem';
import { statusForFilter, STATUS_FILTERS } from './filters';
import { counterpartyName, formatRelativeDate } from './format';

// 17 oct 2026, 3:24 p. m. en Bogotá (UTC−5)
const now = new Date('2026-10-17T20:24:00Z');

describe('formatRelativeDate', () => {
  it.each([
    ['2026-10-17T20:24:00Z', 'hoy, 3:24 p. m.'],
    ['2026-10-17T14:05:00Z', 'hoy, 9:05 a. m.'],
    ['2026-10-16T14:05:00Z', 'ayer, 9:05 a. m.'],
    ['2026-10-12T20:24:00Z', '12 oct, 3:24 p. m.'],
  ])('%s → %s', (iso, expected) => {
    expect(formatRelativeDate(iso, now)).toBe(expected);
  });

  it('usa el día de Bogotá, no el UTC (madrugada UTC = noche anterior)', () => {
    expect(formatRelativeDate('2026-10-18T02:30:00Z', new Date('2026-10-18T03:00:00Z'))).toBe('hoy, 9:30 p. m.');
  });

  it('fecha inválida → texto vacío', () => {
    expect(formatRelativeDate('no-fecha', now)).toBe('');
  });
});

describe('filtros', () => {
  it('cada filtro manda un solo estado y "Todas" ninguno', () => {
    expect(STATUS_FILTERS.map((f) => [f.id, statusForFilter(f.id)])).toEqual([
      ['all', undefined],
      ['completed', 'COMPLETED'],
      ['processing', 'PROCESSING'],
      ['failed', 'FAILED'],
    ]);
  });
});

describe('counterpartyName', () => {
  it('usa el nombre o, sin él, host y ruta de la wallet', () => {
    expect(counterpartyName({ name: 'EPM', walletAddress: 'https://w.test/epm' })).toBe('EPM');
    expect(counterpartyName({ name: null, walletAddress: 'https://ilp.interledger-test.dev/bob' })).toBe(
      'ilp.interledger-test.dev/bob',
    );
  });
});

describe('TransactionItem', () => {
  it.each([
    ['COMPLETED', 'Pago exitoso'],
    ['PROCESSING', 'Enviando el pago…'],
    ['FAILED', 'El pago no se pudo hacer'],
    ['CANCELLED', 'Usted canceló el pago'],
    ['EXPIRED', 'Se venció el tiempo para confirmar'],
    ['AWAITING_CONFIRMATION', 'Esperando su confirmación'],
  ] as const)('muestra el estado %s', async (status, text) => {
    const t = makeTransaction(1, { status, createdAt: '2026-10-17T20:24:00Z' });
    await renderWithProviders(<TransactionItem transaction={t} now={now} />);
    expect(screen.getByText('Comercio 1')).toBeTruthy();
    expect(screen.getByText('$86.401')).toBeTruthy();
    expect(screen.getByText('hoy, 3:24 p. m.')).toBeTruthy();
    expect(screen.getByLabelText(`Comercio 1, $86.401, hoy, 3:24 p. m., ${text}`)).toBeTruthy();
  });

  it('sin nombre muestra la wallet y avisa al tocarlo', async () => {
    const onPress = jest.fn();
    const t = makeTransaction(2, { counterparty: { name: null, walletAddress: 'https://ilp.test/bob' } });
    await renderWithProviders(<TransactionItem transaction={t} onPress={onPress} />);
    expect(screen.getByText('ilp.test/bob')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledWith('pay_002');
  });
});
