import { useLocalSearchParams, useRouter } from 'expo-router';
import { useWalletLinkPolling } from '@/features/wallet-link/use-wallet-link-polling';
import { formatMoney } from '@/lib/money';
import { AmountRow, AppHeader, AppText, Button, Card, ErrorState, Screen } from '@/ui';

export default function LinkResult() {
  const router = useRouter();
  // `status` de la URL es solo el estado inicial (se puede manipular): manda `GET /me/wallet-link`.
  const { status: initial } = useLocalSearchParams<{ status?: string }>();
  const { data, isLoading, isError, refetch } = useWalletLinkPolling();
  const link = data?.link;
  const retry = () => router.replace('/vincular');

  return (
    <Screen>
      <AppHeader />
      {isLoading ? (
        <AppText accessibilityLiveRegion="polite">
          {initial === 'ACTIVE' ? 'Confirmando su permiso…' : 'Revisando su permiso…'}
        </AppText>
      ) : null}
      {isError ? <ErrorState message="No pudimos revisar su permiso." onRetry={() => refetch()} /> : null}

      {!isLoading && !isError && link?.status === 'ACTIVE' ? (
        <>
          <AppText variant="title" accessibilityLiveRegion="polite">
            Su wallet autorizó a TuTranqui
          </AppText>
          <Card>
            <AmountRow label="Monto diario" value={formatMoney(link.dailyLimit)} />
            <AppText color="textMuted">Cada pago lo confirma usted en la app.</AppText>
          </Card>
          <Button label="Empezar a pagar" onPress={() => router.replace('/')} />
        </>
      ) : null}

      {!isLoading && !isError && link?.status === 'PENDING_AUTHORIZATION' ? (
        <AppText variant="title" accessibilityLiveRegion="polite">
          Esperando que apruebe el permiso en su wallet
        </AppText>
      ) : null}

      {!isLoading && !isError && link && ['REJECTED', 'EXPIRED', 'REVOKED'].includes(link.status) ? (
        <>
          <AppText variant="title" accessibilityLiveRegion="polite">
            {link.status === 'REJECTED'
              ? 'No dio el permiso en su wallet'
              : link.status === 'EXPIRED'
                ? 'Se venció el tiempo para dar el permiso'
                : 'El permiso fue quitado'}
          </AppText>
          <AppText color="textMuted">No se movió ni un peso.</AppText>
          <Button label="Intentar de nuevo" onPress={retry} />
        </>
      ) : null}

      {!isLoading && !isError && !link ? (
        <>
          <AppText variant="title">No encontramos su permiso</AppText>
          <Button label="Intentar de nuevo" onPress={retry} />
        </>
      ) : null}
    </Screen>
  );
}
