import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { counterpartyName } from '@/features/transactions/format';
import { TransactionDetail } from '@/features/transactions/components/TransactionDetail';
import { usePayment } from '@/features/transactions/hooks';
import type { Transaction, TransactionsPage } from '@/features/transactions/types';
import { AppHeader, AppText, ErrorState, Screen } from '@/ui';
import type { InfiniteData } from '@tanstack/react-query';

export default function TransactionDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const { data, isLoading, isError, refetch } = usePayment(paymentId);

  // El detalle del pago no trae el nombre del comercio: se toma de la lista ya cargada.
  const cached = queryClient
    .getQueriesData<InfiniteData<TransactionsPage>>({ queryKey: ['transactions'] })
    .flatMap(([, d]) => d?.pages.flatMap((p) => p.items) ?? [])
    .find((t: Transaction) => t.id === paymentId);
  const payment = data?.payment;
  const name = payment
    ? counterpartyName(cached?.counterparty ?? { name: null, walletAddress: payment.receiverWalletAddress })
    : '';

  return (
    <Screen>
      <AppHeader onBack={() => router.back()} />
      <AppText variant="title" accessibilityRole="header">
        Detalle del pago
      </AppText>
      {isLoading ? <AppText color="textMuted">Cargando…</AppText> : null}
      {isError ? <ErrorState message="No pudimos cargar este pago." onRetry={() => refetch()} retryLabel="Reintentar" /> : null}
      {payment ? <TransactionDetail payment={payment} merchantName={name} /> : null}
    </Screen>
  );
}
