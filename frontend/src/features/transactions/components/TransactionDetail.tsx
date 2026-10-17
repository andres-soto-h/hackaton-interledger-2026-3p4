import { formatMoney } from '@/lib/money';
import { AmountRow, AppText, Card, StatusBadge } from '@/ui';
import { formatRelativeDate } from '../format';
import type { PaymentDetail } from '../types';

export function TransactionDetail({ payment: p, merchantName }: { payment: PaymentDetail; merchantName: string }) {
  return (
    <>
      <StatusBadge status={p.status} />
      <Card>
        <AppText variant="heading">{merchantName}</AppText>
        {p.description ? <AppText color="textMuted">{p.description}</AppText> : null}
        <AmountRow label="Recibió" value={formatMoney(p.receiveAmount)} />
        {p.fee ? (
          <AmountRow
            label="Comisión TuTranqui"
            detail={p.fee.percentage ? `${p.fee.percentage} %` : undefined}
            value={formatMoney(p.fee)}
          />
        ) : null}
        <AmountRow label="Total que salió" value={formatMoney(p.totalDebit ?? p.debitAmount)} strong />
        <AmountRow label="Fecha" value={formatRelativeDate(p.createdAt)} />
      </Card>
      <Card tone="alt">
        <AppText variant="label" color="textMuted">
          Número de comprobante
        </AppText>
        <AppText selectable>{p.paymentId}</AppText>
      </Card>
    </>
  );
}
