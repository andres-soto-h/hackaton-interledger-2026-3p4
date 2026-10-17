import { useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeMerchants } from '@/features/merchants/api';
import { parseAmountInput, type AmountParse } from '@/features/payments/amount';
import { paymentQuoteKey, paymentsApi } from '@/features/payments/api';
import { formatMoney } from '@/lib/money';
import { newIdempotencyKey } from '@/lib/uuid';
import { AppHeader, AppText, Button, Screen, TextField } from '@/ui';

export default function SafeMerchantPayment() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { merchantId } = useLocalSearchParams<{ merchantId: string }>();
  const { data } = useSafeMerchants();
  const merchant = data?.items.find((m) => m.id === merchantId);

  const [amount, setAmount] = useState('');
  // La misma llave en cada reintento evita crear dos pagos si el primero sí llegó al backend.
  const idempotencyKey = useRef(newIdempotencyKey()).current;
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!merchant) {
    return (
      <Screen>
        <AppHeader actionLabel="Parar" onAction={() => router.replace('/')} />
        <AppText variant="title">No encontramos ese comercio</AppText>
        <Button label="Volver a comercios seguros" onPress={() => router.replace('/comercios')} />
      </Screen>
    );
  }

  const { walletAddress, assetCode, assetScale, name, fixedAmount } = merchant;
  const amountParse: AmountParse =
    fixedAmount !== null
      ? { ok: true, value: fixedAmount }
      : parseAmountInput(amount, assetScale);
  const montoFinal = amountParse.ok ? amountParse.value : null;

  async function pay() {
    if (creating || !montoFinal) return;
    setCreating(true);
    setError(null);
    try {
      const payment = await paymentsApi.createMerchantPayment(
        {
          receiverWalletAddress: walletAddress,
          amount: { value: montoFinal, assetCode },
          description: name,
        },
        idempotencyKey,
      );
      queryClient.setQueryData(paymentQuoteKey(payment.paymentId), {
        ...payment,
        merchantName: name,
      });
      router.replace(`/pagos/confirmar/${payment.paymentId}` as never);
    } catch {
      setError('No pudimos preparar el pago. Intente de nuevo');
      setCreating(false);
    }
  }

  return (
    <Screen>
      <AppHeader actionLabel="Parar" onAction={() => router.replace('/')} />
      <AppText variant="title">{`Pagar a ${name}`}</AppText>

      {fixedAmount !== null ? (
        <AppText>{`Valor de la factura: ${formatMoney({ value: fixedAmount, assetCode })}`}</AppText>
      ) : (
        <TextField
          label="Valor de la factura"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          error={amountParse.ok ? undefined : amountParse.error}
        />
      )}

      {error ? (
        <AppText color="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}

      <Button label="Pagar" onPress={pay} loading={creating} disabled={!montoFinal} />
    </Screen>
  );
}
