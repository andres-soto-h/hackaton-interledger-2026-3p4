import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePasskeySupport } from '@/features/auth/use-passkey-support';
import { AppHeader, AppText, Button, Card, Screen } from '@/ui';

export default function Welcome() {
  const router = useRouter();
  const { aviso } = useLocalSearchParams<{ aviso?: string }>();
  const supported = usePasskeySupport();

  return (
    <Screen>
      <AppHeader />
      <AppText variant="title">Pague sus servicios con calma</AppText>
      <Card>
        <AppText>
          TuTranqui le ayuda a pagar la luz, el agua y el celular desde su teléfono. Nada se mueve
          sin su sí.
        </AppText>
      </Card>
      {aviso === 'cuenta-eliminada' ? (
        <Card tone="alt" accessibilityRole="alert">
          <AppText>
            Su cuenta fue eliminada. Puede borrar el passkey desde el gestor de contraseñas de su
            dispositivo.
          </AppText>
        </Card>
      ) : null}
      {supported === false ? (
        <Card tone="alt" accessibilityRole="alert">
          <AppText>
            Para usar TuTranqui necesita un navegador compatible con passkeys: Chrome, Edge o Safari
            recientes.
          </AppText>
        </Card>
      ) : null}
      {supported ? (
        <>
          <Button label="Crear cuenta" onPress={() => router.push('/registro' as never)} />
          <Button label="Ya tengo cuenta" variant="secondary" onPress={() => router.push('/ingresar')} />
        </>
      ) : null}
    </Screen>
  );
}
