import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAgent } from '@/features/agent/agent-context';
import { authApi } from '@/features/auth/api';
import { failureDetail } from '@/features/payments/result-text';
import { usePaymentStatus } from '@/features/payments/use-payment-status';
import { formatClock, formatRelativeDate } from '@/features/transactions/format';
import { merchantNameFrom } from '@/features/payments/confirmation';
import { formatMoney } from '@/lib/money';
import { hapticError, hapticSuccess } from '@/ui/haptics';
import { spacing } from '@/theme';
import { AmountRow, AppHeader, AppText, Button, Card, ErrorState, IconBadge, Screen } from '@/ui';

export default function PaymentResult() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const { payment, phase, isError, retry, refetch } = usePaymentStatus(paymentId);
  const agent = useAgent();
  const completed = payment?.status === 'COMPLETED';
  const allowance = useQuery({ queryKey: ['me', 'allowance'], queryFn: authApi.getAllowance, enabled: completed });

  const status = payment?.status;
  const title = TITLES[status ?? 'PROCESSING'];
  useEffect(() => {
    if (phase !== 'final' || !status) return;
    AccessibilityInfo.announceForAccessibility(TITLES[status]);
    if (status === 'COMPLETED') void hapticSuccess();
    else if (status === 'FAILED') void hapticError();
    // La lista y el inicio deben ver el pago ya terminado.
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    // Si el pago salió del chat, el chat muestra su estado final al volver.
    agent.reportPaymentStatus(paymentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, status, queryClient, paymentId]);

  if (phase === 'notFound') {
    return (
      <Screen>
        <AppHeader />
        <AppText variant="title">No encontramos ese pago</AppText>
        <Button label="Ir al inicio" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  if (isError && !payment) {
    return (
      <Screen>
        <ErrorState message="No pudimos revisar el pago." onRetry={() => refetch()} retryLabel="Reintentar" />
      </Screen>
    );
  }

  const merchant = payment ? merchantNameFrom(payment.description, payment.receiverWalletAddress) : '';

  return (
    <Screen>
      <AppHeader />
      {!payment ? <AppText color="textMuted">Revisando su pago…</AppText> : null}

      {payment ? (
        <>
          <View style={styles.hero}>
            <IconBadge
              name={HERO[phase === 'timeout' ? 'PROCESSING' : payment.status]?.icon ?? 'time'}
              tone={HERO[phase === 'timeout' ? 'PROCESSING' : payment.status]?.tone ?? 'primary'}
              solid
              size={88}
            />
            {phase !== 'timeout' ? (
              <AppText variant="title" accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.center}>
                {title}
              </AppText>
            ) : (
              <AppText variant="title" accessibilityLiveRegion="polite" style={styles.center}>
                El pago sigue en proceso
              </AppText>
            )}
          </View>

          {payment.status === 'PROCESSING' && phase === 'polling' ? (
            <AppText color="textMuted">Esto toma unos segundos.</AppText>
          ) : null}
          {phase === 'timeout' ? (
            <>
              <AppText>El pago sigue en proceso. Lo puede revisar en sus transacciones</AppText>
              <Button label="Consultar de nuevo" onPress={retry} />
            </>
          ) : null}

          {payment.status === 'COMPLETED' ? (
            <>
              <AppText>{`${merchant} lo recibió a las ${formatClock(payment.updatedAt)}.`}</AppText>
              <Card>
                <AmountRow label="Recibió" value={formatMoney(payment.receiveAmount)} />
                {payment.fee ? <AmountRow label="Comisión TuTranqui" value={formatMoney(payment.fee)} /> : null}
                <AmountRow label="Total pagado" value={formatMoney(payment.totalDebit ?? payment.debitAmount)} strong />
                {allowance.data ? (
                  <AmountRow label="Le queda hoy" detail="de su monto diario" value={formatMoney(allowance.data.available)} />
                ) : null}
                <AmountRow label="Fecha" value={formatRelativeDate(payment.updatedAt)} />
              </Card>
              <Card tone="alt">
                <AppText variant="label" color="textMuted">
                  Número de comprobante
                </AppText>
                <AppText selectable>{payment.paymentId}</AppText>
              </Card>
            </>
          ) : null}

          {payment.status === 'FAILED' ? <AppText>{failureDetail(payment)}</AppText> : null}
          {payment.status === 'CANCELLED' ? <AppText>No se movió ni un peso.</AppText> : null}
          {payment.status === 'EXPIRED' ? (
            <AppText>No se movió ni un peso. Puede prepararlo otra vez.</AppText>
          ) : null}

          {phase !== 'polling' || payment.status !== 'PROCESSING' ? (
            <>
              {payment.status === 'CANCELLED' || payment.status === 'EXPIRED' || payment.status === 'FAILED' ? (
                <Button label="Preparar el pago otra vez" icon="refresh" onPress={() => router.replace('/pagos')} />
              ) : (
                <Button label="Pagar algo más" icon="add-circle" onPress={() => router.replace('/pagos')} />
              )}
              {agent.isFromChat(paymentId) ? (
                <Button label="Volver al chat" icon="chatbubble-ellipses" onPress={() => router.replace('/agente')} />
              ) : null}
              <Button label="Ver mis transacciones" icon="list" variant="secondary" onPress={() => router.replace('/transacciones')} />
              <Button label="Ir al inicio" icon="home" variant="ghost" onPress={() => router.replace('/')} />
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const HERO: Record<string, { icon: string; tone: 'primary' | 'success' | 'danger' | 'accent' }> = {
  AWAITING_CONFIRMATION: { icon: 'hourglass', tone: 'primary' },
  PROCESSING: { icon: 'hourglass', tone: 'primary' },
  COMPLETED: { icon: 'checkmark', tone: 'success' },
  FAILED: { icon: 'alert', tone: 'danger' },
  CANCELLED: { icon: 'close', tone: 'primary' },
  EXPIRED: { icon: 'time', tone: 'danger' },
};

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.lg },
  center: { textAlign: 'center' },
});

const TITLES: Record<string, string> = {
  AWAITING_CONFIRMATION: 'Esperando su confirmación',
  PROCESSING: 'Enviando el pago…',
  COMPLETED: 'Listo. Su pago quedó hecho.',
  FAILED: 'El pago no se pudo hacer',
  CANCELLED: 'Usted canceló el pago',
  EXPIRED: 'Se venció el tiempo para confirmar',
};
