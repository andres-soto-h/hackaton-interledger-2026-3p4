import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { loginErrorMessage, useLogin } from '@/features/auth/use-login';
import { useSession } from '@/features/auth/session';
import { usePasskeySupport } from '@/features/auth/use-passkey-support';
import { AppHeader, AppText, Button, Card, Screen } from '@/ui';

export default function SignIn() {
  const router = useRouter();
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const { sessionEnded } = useSession();
  const supported = usePasskeySupport();
  const login = useLogin();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPress() {
    setLoading(true);
    setError(null);
    try {
      await login();
      // Solo se vuelve a rutas internas de la app (nunca a una URL externa).
      router.replace(redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? (redirect as never) : '/');
    } catch (e) {
      setError(loginErrorMessage(e));
      setLoading(false);
    }
  }

  return (
    <Screen>
      <AppHeader />
      <AppText variant="title">Ingrese a su cuenta</AppText>
      {sessionEnded ? (
        <Card tone="alt">
          <AppText accessibilityLiveRegion="polite">Su sesión terminó, ingrese de nuevo</AppText>
        </Card>
      ) : null}
      <AppText color="textMuted">
        Use la huella, el rostro o el PIN de su teléfono. No hay contraseñas que recordar.
      </AppText>
      {error ? (
        <AppText color="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      {supported === false ? (
        <Card tone="alt" accessibilityRole="alert">
          <AppText>Necesita un navegador compatible con passkeys: Chrome, Edge o Safari recientes.</AppText>
        </Card>
      ) : (
        <Button label="Ingresar con mi passkey" onPress={onPress} loading={loading} disabled={!supported} />
      )}
      <Button label="Crear cuenta" variant="ghost" onPress={() => router.push('/registro' as never)} />
    </Screen>
  );
}
