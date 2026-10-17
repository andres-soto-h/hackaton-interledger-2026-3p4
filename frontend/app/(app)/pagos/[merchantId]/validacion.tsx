import { useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMerchant } from '@/features/merchants/hooks';
import { paymentQuoteKey, paymentsApi } from '@/features/payments/api';
import { paymentErrorMessage } from '@/features/payments/errors';
import { useMerchantValidation } from '@/features/payments/use-merchant-validation';
import { hasBlockingError } from '@/features/payments/verify';
import { newIdempotencyKey } from '@/lib/uuid';
import { AppHeader, AppText, Button, Card, CheckItem, ErrorState, Screen, StepIndicator } from '@/ui';
import type { Merchant } from '@/features/merchants/types';

export default function MerchantValidation() {
  const router = useRouter();
  const { merchantId, reference, amount, note } = useLocalSearchParams<{
    merchantId: string;
    reference: string;
    amount: string;
    note?: string;
  }>();
  const merchant = useMerchant(merchantId);
  if (!merchant || !reference || !amount) {
    return (
      <Screen>
        <AppHeader onBack={() => router.replace('/')} />
        <AppText variant="title">Faltan datos del pago</AppText>
        <Button label="Volver a empezar" onPress={() => router.replace('/pagos')} />
      </Screen>
    );
  }
  return <Validation merchant={merchant} reference={reference} amount={amount} note={note} />;
}

function Validation({
  merchant,
  reference,
  amount,
  note,
}: {
  merchant: Merchant;
  reference: string;
  amount: string;
  note?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const validation = useMerchantValidation(merchant);
  // La misma llave en cada reintento evita crear dos pagos si el primero sí llegó al backend.
  const idempotencyKey = useRef(newIdempotencyKey()).current;
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);

  const blocked = hasBlockingError(validation.steps);

  async function createPayment() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const description = `${merchant.name} · ${merchant.referenceLabel.toLowerCase()} ${reference}${note ? ` · ${note}` : ''}`.slice(0, 140);
      const payment = await paymentsApi.createMerchantPayment(
        {
          receiverWalletAddress: merchant.walletAddress,
          amount: { value: amount, assetCode: merchant.assetCode },
          description,
        },
        idempotencyKey,
      );
      queryClient.setQueryData(paymentQuoteKey(payment.paymentId), { ...payment, merchantName: merchant.name });
      router.replace(`/pagos/confirmar/${payment.paymentId}` as never);
    } catch (e) {
      setError(paymentErrorMessage(e));
      setCreating(false);
    }
  }

  return (
    <Screen>
      <AppHeader onBack={() => router.replace('/')} />
      <StepIndicator step={2} total={3} name="Revisando el comercio" />
      <AppText variant="title">{`Revisando la cuenta de ${merchant.name}`}</AppText>

      {validation.isError ? (
        <ErrorState message="No pudimos revisar la cuenta. Intente de nuevo." onRetry={validation.retry} />
      ) : (
        <Card>
          {validation.steps.map((step, i) => (
            <CheckItem
              key={step.id}
              title={step.title}
              detail={i < validation.revealed ? step.detail : undefined}
              status={i < validation.revealed ? step.status : 'pending'}
            />
          ))}
          {validation.steps.length === 0 ? <AppText color="textMuted">Revisando…</AppText> : null}
        </Card>
      )}

      {validation.done && blocked ? (
        <AppText color="danger" accessibilityRole="alert">
          {`No pudimos comprobar la cuenta de ${merchant.name}. No se ha movido ni un peso`}
        </AppText>
      ) : null}
      {validation.done && !blocked ? (
        <AppText variant="heading" accessibilityLiveRegion="polite">
          {`Listo, ya revisé. La cuenta de ${merchant.name} es la correcta`}
        </AppText>
      ) : null}

      {error ? (
        <>
          <AppText color="danger" accessibilityRole="alert">
            {error.message}
          </AppText>
          {error.requestId ? (
            <AppText variant="caption" color="textMuted">{`Código para soporte: ${error.requestId}`}</AppText>
          ) : null}
        </>
      ) : null}

      {validation.done && !blocked ? (
        <Button label="Seguir con el pago" onPress={createPayment} loading={creating} />
      ) : null}
      {validation.done && blocked ? (
        <Button label="Elegir otro servicio" variant="secondary" onPress={() => router.replace('/pagos')} />
      ) : null}
    </Screen>
  );
}
