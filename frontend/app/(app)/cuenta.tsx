import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/features/auth/api';
import { useSession } from '@/features/auth/session';
import { accountKeys, useAllowance, useMe, useWalletLink } from '@/features/auth/use-account';
import { useReauthAction } from '@/features/auth/use-login';
import type { WalletLink } from '@/features/auth/types';
import { formatMoney } from '@/lib/money';
import { AmountRow, AppHeader, AppText, Button, Card, ConfirmPanel, ErrorState, Screen } from '@/ui';

type Confirming = 'unlink' | 'signOut' | 'delete' | null;

function permissionText(link: WalletLink | null | undefined): string {
  if (!link) return 'Todavía no ha dado permiso en su wallet';
  switch (link.status) {
    case 'ACTIVE':
      return 'Permiso activo';
    case 'PENDING_AUTHORIZATION':
      return 'Esperando que apruebe el permiso en su wallet';
    default:
      return 'El permiso no está activo';
  }
}

export default function Account() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: sessionUser, signOut } = useSession();
  const me = useMe();
  const walletLink = useWalletLink();
  const active = walletLink.data?.status === 'ACTIVE';
  const allowance = useAllowance(active);
  const withReauth = useReauthAction();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = me.data ?? sessionUser;

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch {
      setError('No pudimos hacerlo. Intente de nuevo.');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const unlink = () =>
    run(async () => {
      await withReauth(authApi.deleteWalletLink);
      queryClient.setQueryData(accountKeys.walletLink, null);
      queryClient.setQueryData(accountKeys.allowance, null);
    });

  const leave = (notice?: string) =>
    run(async () => {
      if (notice) await withReauth(authApi.deleteMe);
      await signOut();
      router.replace(notice ? { pathname: '/bienvenida', params: { aviso: notice } } : '/bienvenida');
    });

  return (
    <Screen>
      <AppHeader actionLabel="Inicio" onAction={() => router.replace('/')} />
      <AppText variant="title" accessibilityRole="header">
        Mi cuenta
      </AppText>

      {me.isError && !user ? <ErrorState message="No pudimos cargar sus datos." onRetry={() => me.refetch()} /> : null}
      {user ? (
        <Card>
          <AppText variant="heading">{user.displayName}</AppText>
          <AppText variant="label" color="textMuted">
            Su wallet
          </AppText>
          <AppText>{user.walletAddress}</AppText>
        </Card>
      ) : null}

      <Card>
        <AppText variant="heading">Permiso en su wallet</AppText>
        {walletLink.isLoading ? <AppText color="textMuted">Revisando…</AppText> : null}
        {walletLink.isError ? (
          <ErrorState message="No pudimos revisar el permiso." onRetry={() => walletLink.refetch()} />
        ) : null}
        {!walletLink.isLoading && !walletLink.isError ? (
          <AppText accessibilityLiveRegion="polite">{permissionText(walletLink.data)}</AppText>
        ) : null}
        {active && walletLink.data ? (
          <AmountRow label="Monto diario" value={formatMoney(walletLink.data.dailyLimit)} />
        ) : null}
        {active && allowance.data ? (
          <AmountRow label="Le queda hoy" value={formatMoney(allowance.data.available)} strong />
        ) : null}
        {!walletLink.isLoading && !walletLink.isError && !active ? (
          <Button label="Vincular mi wallet" onPress={() => router.push('/vincular' as never)} />
        ) : null}
        {active ? (
          <Button label="Quitar permiso" variant="secondary" onPress={() => setConfirming('unlink')} />
        ) : null}
      </Card>

      {error ? (
        <AppText color="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}

      {confirming === 'unlink' ? (
        <ConfirmPanel
          question="TuTranqui no podrá pagar por usted hasta que vuelva a dar el permiso. ¿Lo quita?"
          confirmLabel="Sí, quitar permiso"
          loading={busy}
          onConfirm={unlink}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === 'signOut' ? (
        <ConfirmPanel
          question="¿Quiere cerrar su sesión?"
          confirmLabel="Sí, cerrar sesión"
          loading={busy}
          onConfirm={() => leave()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === 'delete' ? (
        <ConfirmPanel
          question="Se borrará su cuenta y su permiso en la wallet. Esto no se puede deshacer. ¿Continúa?"
          confirmLabel="Sí, eliminar mi cuenta"
          danger
          loading={busy}
          onConfirm={() => leave('cuenta-eliminada')}
          onCancel={() => setConfirming(null)}
        />
      ) : null}

      <Button label="Cerrar sesión" variant="secondary" onPress={() => setConfirming('signOut')} />
      <Button label="Eliminar mi cuenta" variant="ghost" onPress={() => setConfirming('delete')} />
    </Screen>
  );
}
