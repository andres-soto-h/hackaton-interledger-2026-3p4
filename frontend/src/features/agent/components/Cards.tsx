import { useRouter } from 'expo-router';
import { merchantNameFrom } from '@/features/payments/confirmation';
import { usePayment } from '@/features/transactions/hooks';
import { formatMoney } from '@/lib/money';
import { AmountRow, AppText, Button, Card, StatusBadge } from '@/ui';
import { useAgent } from '../agent-context';

/** Lo que se muestra sale de la API (`GET /payments/{id}`), no del texto del modelo. */
export function PaymentProposalCard({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const { markFromChat } = useAgent();
  const { data, isLoading, isError } = usePayment(paymentId, { poll: false });
  const p = data?.payment;
  return (
    <Card>
      <AppText variant="bodyStrong">Pago preparado</AppText>
      {isLoading ? <AppText color="textMuted">Cargando…</AppText> : null}
      {isError ? <AppText color="danger">No pudimos cargar este pago.</AppText> : null}
      {p ? (
        <>
          <AmountRow label="Le paga a" value={merchantNameFrom(p.description, p.receiverWalletAddress)} />
          <AmountRow label="Recibe" value={formatMoney(p.receiveAmount)} />
          {p.fee ? <AmountRow label="Comisión TuTranqui" value={formatMoney(p.fee)} /> : null}
          <AmountRow label="Total" value={formatMoney(p.totalDebit ?? p.debitAmount)} strong />
          <Button
            label="Revisar y confirmar"
            accessibilityHint="Usted confirma con su passkey; el asistente no puede hacerlo por usted"
            onPress={() => {
              markFromChat(paymentId);
              router.push(`/pagos/confirmar/${paymentId}` as never);
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

export function PaymentStatusCard({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const { data } = usePayment(paymentId, { poll: false });
  const p = data?.payment;
  if (!p) return null;
  return (
    <Card>
      <StatusBadge status={p.status} />
      <AmountRow label={merchantNameFrom(p.description, p.receiverWalletAddress)} value={formatMoney(p.totalDebit ?? p.debitAmount)} />
      <Button label="Ver el detalle" variant="secondary" onPress={() => router.push(`/transacciones/${paymentId}` as never)} />
    </Card>
  );
}

export function MerchantChoice({
  options,
  onChoose,
}: {
  options: { merchantId: string; label: string }[];
  onChoose: (label: string) => void;
}) {
  return (
    <Card tone="alt">
      <AppText variant="label" color="textMuted">
        ¿Cuál es?
      </AppText>
      {options.map((o) => (
        <Button key={o.merchantId} label={o.label} variant="secondary" onPress={() => onChoose(o.label)} />
      ))}
    </Card>
  );
}
