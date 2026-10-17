import { Platform, Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '../../tests/utils/render';
import { AmountRow } from './AmountRow';
import { Button } from './Button';
import { EmptyState, ErrorState } from './States';
import { Screen } from './Screen';
import { StatusBadge, type PaymentStatus } from './StatusBadge';
import { TextField } from './TextField';

describe('Button', () => {
  it('es accesible por rol y nombre y dispara onPress', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Sí, pagar" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sí, pagar' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('no dispara onPress si está deshabilitado', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Seguir" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeDisabled();
  });

  it('no dispara onPress mientras carga y lo anuncia como ocupado', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Seguir" onPress={onPress} loading />);
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeBusy();
  });
});

describe('TextField', () => {
  it('se encuentra por su etiqueta y muestra la ayuda', async () => {
    await renderWithProviders(<TextField label="Nombre" help="Como en su cédula" value="" onChangeText={() => {}} />);
    expect(screen.getByLabelText('Nombre')).toBeTruthy();
    expect(screen.getByText('Como en su cédula')).toBeTruthy();
  });

  it('muestra el error como texto y lo anuncia', async () => {
    await renderWithProviders(
      <TextField label="Nombre" error="Escriba su nombre" value="" onChangeText={() => {}} />,
    );
    const error = screen.getByText('Escriba su nombre');
    expect(error).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('propaga el texto escrito', async () => {
    const onChangeText = jest.fn();
    await renderWithProviders(<TextField label="Nombre" value="" onChangeText={onChangeText} />);
    await fireEvent.changeText(screen.getByLabelText('Nombre'), 'Ana');
    expect(onChangeText).toHaveBeenCalledWith('Ana');
  });
});

describe('AmountRow', () => {
  it('muestra etiqueta, detalle y valor, con etiqueta accesible', async () => {
    await renderWithProviders(<AmountRow label="Comisión" detail="1,5 %" value="US$0,38" />);
    expect(screen.getByText('Comisión')).toBeTruthy();
    expect(screen.getByText('1,5 %')).toBeTruthy();
    expect(screen.getByText('US$0,38')).toBeTruthy();
    expect(screen.getByLabelText('Comisión, 1,5 %: US$0,38')).toBeTruthy();
  });
});

describe('StatusBadge', () => {
  it.each<[PaymentStatus, string]>([
    ['AWAITING_CONFIRMATION', 'Esperando su confirmación'],
    ['PROCESSING', 'Enviando el pago…'],
    ['COMPLETED', 'Pago exitoso'],
    ['FAILED', 'El pago no se pudo hacer'],
    ['CANCELLED', 'Usted canceló el pago'],
    ['EXPIRED', 'Se venció el tiempo para confirmar'],
  ])('%s se lee como "%s"', async (status, text) => {
    await renderWithProviders(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByLabelText(`Estado: ${text}`)).toBeTruthy();
  });
});

describe('EmptyState y ErrorState', () => {
  it('ErrorState ofrece reintentar', async () => {
    const onRetry = jest.fn();
    await renderWithProviders(<ErrorState message="No pudimos cargar" onRetry={onRetry} />);
    expect(screen.getByText('No pudimos cargar')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('EmptyState muestra el mensaje', async () => {
    await renderWithProviders(<EmptyState message="Aún no tiene transacciones" />);
    expect(screen.getByText('Aún no tiene transacciones')).toBeTruthy();
  });
});

describe('Screen', () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
  });

  it('limita el contenido a 480 de ancho en web', async () => {
    Platform.OS = 'web';
    await renderWithProviders(
      <Screen testID="screen">
        <Text>Hola</Text>
      </Screen>,
    );
    expect(screen.getByTestId('screen-content')).toHaveStyle({ maxWidth: 480, width: '100%' });
    expect(screen.getByText('Hola')).toBeTruthy();
  });
});
