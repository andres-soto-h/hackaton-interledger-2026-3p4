import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { authApi } from '@/features/auth/api';
import { usePasskeys } from '@/features/auth/passkeys-context';
import { paymentQuoteKey } from '@/features/payments/api';
import { buildBreakdown, buildSpokenSummary, toConfirmationView, type QuoteSource } from '@/features/payments/confirmation';
import { cancelPayment, confirmErrorKind, confirmPayment, type ConfirmErrorKind } from '@/features/payments/confirm';
import { formatCountdown, useCountdown } from '@/features/payments/use-countdown';
import { usePayment } from '@/features/transactions/hooks';
import { formatMoney } from '@/lib/money';
import { AmountRow, AppHeader, AppText, Button, Card, ErrorState, Screen, StepIndicator } from '@/ui';

const MESSAGES: Partial<Record<ConfirmErrorKind, string>> = {
  cancelled: 'No se confirmó el pago. No se movió ni un peso.',
  retry: 'No pudimos comprobar su passkey. Intente de nuevo.',
  expired: 'Se venció el tiempo. Prepare el pago otra vez',
  unknown: 'No pudimos hacer el pago. Intente de nuevo en un momento.',
};

export default function ConfirmPayment() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const passkeys = usePasskeys();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const cached = queryClient.getQueryData<QuoteSource>(paymentQuoteKey(paymentId));
  const fetched = usePayment(paymentId, { enabled: !cached });
  const source = cached ?? fetched.data?.payment;
  const view = useMemo(() => (source ? toConfirmationView(source) : null), [source]);
  const { secondsLeft, expired: timeUp } = useCountdown(view?.confirmBy);
  const spoken = useMemo(() => (view ? buildSpokenSummary(view) : ''), [view]);

  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ConfirmErrorKind | null>(null);
  const [leftToday, setLeftToday] = useState<string | null>(null);

  useEffect(() => {
    if (spoken) AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  if (!source && fetched.isError) {
    return (
      <Screen>
        <ErrorState message="No pudimos cargar el pago." onRetry={() => fetched.refetch()} retryLabel="Reintentar" />
      </Screen>
    );
  }
  if (!view) {
    return (
      <Screen>
        <AppText color="textMuted">Preparando su pago…</AppText>
      </Screen>
    );
  }
  if (view.status !== 'AWAITING_CONFIRMATION') {
    return <Redirect href={`/pagos/resultado/${paymentId}` as never} />;
  }

  const expired = timeUp || kind === 'expired';

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setKind(null);
    try {
      await confirmPayment(paymentId, passkeys);
      router.replace(`/pagos/resultado/${paymentId}` as never);
    } catch (error) {
      const k = confirmErrorKind(error);
      if (k === 'not-confirmable') {
        router.replace(`/pagos/resultado/${paymentId}` as never);
        return;
      }
      if (k === 'daily-limit') {
        const allowance = await authApi.getAllowance().catch(() => null);
        setLeftToday(allowance ? formatMoney(allowance.available) : null);
      }
      setKind(k);
      setBusy(false);
    }
  }

  async function dontPay() {
    if (busy) return;
    setBusy(true);
    try {
      await cancelPayment(paymentId);
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'PAYMENT_NOT_CONFIRMABLE')) {
        setKind('unknown');
        setBusy(false);
        return;
      }
    }
    router.replace('/');
  }

  return (
    <Screen>
      <AppHeader />
      <StepIndicator step={3} total={3} name="Revisar y decir sí" />
      <AppText variant="title" accessibilityRole="header">
        Revise su pago
      </AppText>
      <AppText>{spoken}</AppText>
      <Card>
        {buildBreakdown(view).map(({ id, ...row }) => (
          <AmountRow key={id} {...row} />
        ))}
      </Card>

      {secondsLeft !== null && !expired ? (
        <AppText
          variant="label"
          color={secondsLeft < 60 ? 'danger' : 'textMuted'}
          accessibilityLabel={`Tiene ${formatCountdown(secondsLeft)} para confirmar`}
        >
          {`Tiene ${formatCountdown(secondsLeft)} para confirmar`}
        </AppText>
      ) : null}

      {kind === 'daily-limit' ? (
        <AppText color="danger" accessibilityRole="alert">
          {`Este pago pasa su monto de hoy.${leftToday ? ` Hoy le quedan ${leftToday}.` : ''}`}
        </AppText>
      ) : null}
      {kind && kind !== 'daily-limit' && kind !== 'relink' && MESSAGES[kind] && !(kind === 'expired') ? (
        <AppText color="danger" accessibilityRole="alert">
          {MESSAGES[kind]}
        </AppText>
      ) : null}
      {expired ? (
        <AppText color="danger" accessibilityRole="alert">
          {MESSAGES.expired}
        </AppText>
      ) : null}
      {kind === 'relink' ? (
        <>
          <AppText color="danger" accessibilityRole="alert">
            Debe vincular su wallet otra vez para poder pagar.
          </AppText>
          <Button label="Vincular mi wallet" onPress={() => router.push('/vincular')} />
        </>
      ) : null}

      {expired ? (
        <Button label="Preparar el pago otra vez" onPress={() => router.replace('/pagos')} />
      ) : (
        <>
          <Button
            label="Sí, pagar"
            accessibilityHint="Usa su huella o el bloqueo del teléfono para confirmar"
            onPress={confirm}
            loading={busy}
            disabled={kind === 'relink'}
          />
          <Button label="Repítamelo" variant="secondary" onPress={() => AccessibilityInfo.announceForAccessibility(spoken)} />
        </>
      )}
      <Button label="No pagar" variant="ghost" onPress={dontPay} disabled={busy} />
    </Screen>
  );
}
