import { useRouter } from 'expo-router';
import { useSafeMerchants } from '@/features/merchants/api';
import { formatMoney } from '@/lib/money';
import { AppHeader, AppText, ErrorState, MerchantTile, Screen } from '@/ui';

export default function SafeMerchants() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSafeMerchants();

  return (
    <Screen>
      <AppHeader onBack={() => router.replace('/')} />
      <AppText variant="title">Comercios seguros</AppText>
      {isLoading ? <AppText color="textMuted">Cargando…</AppText> : null}
      {isError ? (
        <ErrorState message="No pudimos cargar los comercios." onRetry={() => refetch()} />
      ) : null}
      {data?.items.map((m) => (
        <MerchantTile
          key={m.id}
          name={m.name}
          subtitle={
            m.fixedAmount !== null
              ? formatMoney({ value: m.fixedAmount, assetCode: m.assetCode })
              : 'Monto a ingresar'
          }
          icon="storefront"
          onPress={() => router.push(`/comercios/${m.id}` as never)}
        />
      ))}
    </Screen>
  );
}
