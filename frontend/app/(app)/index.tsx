import { useRouter } from 'expo-router';
import { useSession } from '@/features/auth/session';
import { TransactionItem } from '@/features/transactions/components/TransactionItem';
import { useRecentTransactions } from '@/features/transactions/hooks';
import { LinkWalletBanner } from '@/features/wallet-link/components/LinkWalletBanner';
import { AppHeader, AppText, Button, EmptyState, ErrorState, Screen } from '@/ui';

export default function Home() {
  const router = useRouter();
  const { user } = useSession();
  const recent = useRecentTransactions();
  const items = recent.data?.pages.flatMap((p) => p.items) ?? [];
  const firstName = user?.displayName.split(' ')[0] ?? '';

  return (
    <Screen>
      <AppHeader actionLabel="Mi cuenta" onAction={() => router.push('/cuenta')} />
      <AppText variant="title">{`Hola, ${firstName}. ¿Qué pagamos hoy?`}</AppText>
      <LinkWalletBanner />
      <Button
        label="Toque y dígame qué pagar"
        accessibilityHint="Abre el asistente de TuTranqui"
        onPress={() => router.push('/agente' as never)}
      />
      <Button label="Pagar un servicio" variant="secondary" onPress={() => router.push('/pagos' as never)} />

      <AppText variant="heading" accessibilityRole="header">
        Últimos pagos
      </AppText>
      {recent.isLoading ? <AppText color="textMuted">Cargando sus pagos…</AppText> : null}
      {recent.isError ? (
        <ErrorState message="No pudimos cargar sus pagos." onRetry={() => recent.refetch()} retryLabel="Reintentar" />
      ) : null}
      {!recent.isLoading && !recent.isError && items.length === 0 ? (
        <EmptyState message="Todavía no ha hecho pagos" />
      ) : null}
      {items.slice(0, 5).map((t) => (
        <TransactionItem key={t.id} transaction={t} onPress={(id) => router.push(`/transacciones/${id}` as never)} />
      ))}
      {items.length > 0 ? (
        <Button label="Ver todas" variant="ghost" onPress={() => router.push('/transacciones')} />
      ) : null}
    </Screen>
  );
}
