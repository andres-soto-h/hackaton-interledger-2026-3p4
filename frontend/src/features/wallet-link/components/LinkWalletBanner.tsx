import { useRouter } from 'expo-router';
import { useWalletLink } from '@/features/auth/use-account';
import { AppText, Button, Card } from '@/ui';

/** Aviso del inicio mientras la cuenta no tenga una vinculación activa. */
export function LinkWalletBanner() {
  const router = useRouter();
  const { data: link, isLoading, isError } = useWalletLink();
  if (isLoading || isError || link?.status === 'ACTIVE') return null;
  const pending = link?.status === 'PENDING_AUTHORIZATION';
  return (
    <Card tone="alt" accessibilityLiveRegion="polite">
      <AppText variant="heading">
        {pending ? 'Falta aprobar el permiso en su wallet' : 'Vincule su wallet para empezar a pagar'}
      </AppText>
      <AppText color="textMuted">Sin el permiso no podemos pagar por usted.</AppText>
      <Button
        label={pending ? 'Seguir con el permiso' : 'Vincular mi wallet'}
        onPress={() => router.push('/vincular')}
      />
    </Card>
  );
}
