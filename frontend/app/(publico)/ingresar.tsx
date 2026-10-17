import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { loginErrorMessage, useLogin } from '@/features/auth/use-login';
import { useSession } from '@/features/auth/session';
import { emailSchema } from '@/features/auth/schemas';
import { usePasskeySupport } from '@/features/auth/use-passkey-support';
import { AppHeader, AppText, Button, Card, Screen, TextField } from '@/ui';

export default function SignIn() {
  const router = useRouter();
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const { sessionEnded } = useSession();
  const supported = usePasskeySupport();
  const login = useLogin();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();

  async function onPress() {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message);
      return;
    }
    setEmailError(undefined);
    setLoading(true);
    setError(null);
    try {
      await login(parsed.data);
      // Solo se vuelve a rutas internas de la app (nunca a una URL externa).
      router.replace(redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? (redirect as never) : '/');
    } catch (e) {
      console.error('[passkey] ingreso', e);
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
      <TextField
        label="Su correo"
        value={email}
        onChangeText={setEmail}
        error={emailError}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
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
