import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseAmountInput } from '@/features/payments/amount';
import { useMerchant } from '@/features/merchants/hooks';
import { formatMoney } from '@/lib/money';
import { AppHeader, AppText, Button, Screen, StepIndicator, TextField } from '@/ui';

export default function PaymentData() {
  const router = useRouter();
  const { merchantId } = useLocalSearchParams<{ merchantId: string }>();
  const merchant = useMerchant(merchantId);
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ reference?: string; amount?: string }>({});

  if (!merchant) {
    return (
      <Screen>
        <AppHeader actionLabel="Parar" onAction={() => router.replace('/')} />
        <AppText variant="title">No encontramos ese servicio</AppText>
        <Button label="Ver servicios" onPress={() => router.replace('/pagos')} />
      </Screen>
    );
  }

  function next() {
    if (!merchant) return;
    const next: typeof errors = {};
    if (reference.trim().length < 3) next.reference = `Escriba su ${merchant.referenceLabel.toLowerCase()}`;
    const parsed = parseAmountInput(amount, merchant.assetScale);
    if (!parsed.ok) next.amount = parsed.error;
    setErrors(next);
    if (next.reference || !parsed.ok) return;
    const query = new URLSearchParams({ reference: reference.trim(), amount: parsed.value });
    if (note.trim()) query.set('note', note.trim());
    router.push(`/pagos/${merchant.id}/validacion?${query.toString()}` as never);
  }

  return (
    <Screen>
      <AppHeader actionLabel="Parar" onAction={() => router.replace('/')} />
      <StepIndicator step={1} total={3} name="Datos del pago" />
      <AppText variant="title">{`Pagar ${merchant.name}`}</AppText>
      <TextField
        label={merchant.referenceLabel}
        value={reference}
        onChangeText={setReference}
        error={errors.reference}
        autoCorrect={false}
      />
      <TextField
        label="Valor de la factura"
        help={`En pesos colombianos. Ejemplo: ${formatMoney({ value: '86400.00', assetCode: 'COP' })}`}
        value={amount}
        onChangeText={setAmount}
        error={errors.amount}
        keyboardType="decimal-pad"
      />
      <TextField label="Nota (opcional)" value={note} onChangeText={setNote} maxLength={60} />
      <Button label="Seguir" onPress={next} />
    </Screen>
  );
}
