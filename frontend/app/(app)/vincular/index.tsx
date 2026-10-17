import { useRouter } from 'expo-router';
import { useStartLink } from '@/features/wallet-link/use-start-link';
import { AppHeader, AppText, Button, Card, Screen, StepIndicator } from '@/ui';

export default function LinkWallet() {
  const router = useRouter();
  const { start, loading, error } = useStartLink();

  return (
    <Screen>
      <AppHeader actionLabel="Ahora no" onAction={() => router.replace('/')} />
      <StepIndicator step={3} total={3} name="Permiso en su wallet" />
      <AppText variant="title">Dé su permiso una sola vez</AppText>
      <Card>
        <AppText variant="bodyStrong">TuTranqui podrá:</AppText>
        <AppText>Pagar sus servicios hasta un monto diario, que usted verá y aprobará en su wallet.</AppText>
        <AppText variant="bodyStrong">TuTranqui no podrá:</AppText>
        <AppText>Pagar sin su sí. Cada pago lo confirma usted en la app con su passkey.</AppText>
      </Card>
      {error ? (
        <AppText color="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      <Button label="Ir a mi wallet" onPress={start} loading={loading} />
    </Screen>
  );
}
