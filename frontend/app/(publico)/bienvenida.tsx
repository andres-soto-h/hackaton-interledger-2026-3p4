import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePasskeySupport } from '@/features/auth/use-passkey-support';
import { APP_VERSION } from '@/lib/version';
import { colors, radii, spacing } from '@/theme';
import { AppText, BrandMark, Button, Card, PressableScale, Screen } from '@/ui';

const STEPS = [
  'Nos dice cuál es su banco',
  'Le da permiso a TuTranqui en la pantalla de su banco',
  'Listo. No se lo volvemos a pedir',
];

export default function Welcome() {
  const router = useRouter();
  const { aviso } = useLocalSearchParams<{ aviso?: string }>();
  const supported = usePasskeySupport();

  return (
    <Screen tone="dark">
      <View style={styles.hero}>
        <View style={styles.logoRing}>
          <BrandMark size={150} />
        </View>
        <AppText variant="title" color="surface" style={styles.tagline}>
          Pague lo de todos los días sin fila y sin pasaje
        </AppText>
      </View>

      <Card>
        <AppText variant="heading" accessibilityRole="header">
          Esto se hace una sola vez
        </AppText>
        {STEPS.map((text, i) => (
          <View key={text} style={styles.step}>
            <View style={styles.stepNumber}>
              <AppText variant="labelStrong" color="primary">
                {String(i + 1)}
              </AppText>
            </View>
            <AppText style={styles.stepText}>{text}</AppText>
          </View>
        ))}
        <AppText variant="caption" color="textMuted">
          Toma unos 3 minutos.
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
        <View style={styles.actions}>
          <Button
            label="Empezar"
            variant="accent"
            icon="arrow-forward"
            onPress={() => router.push('/registro' as never)}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Ya tengo cuenta"
            haptic="tap"
            onPress={() => router.push('/ingresar')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.link}
          >
            <AppText variant="bodyStrong" color="surface" style={styles.underline}>
              Ya tengo cuenta
            </AppText>
          </PressableScale>
        </View>
      ) : null}
      <AppText variant="caption" style={styles.version}>
        {APP_VERSION}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xl, paddingTop: spacing.xl },
  // Aro blanco: da al logo un fondo limpio sobre el azul.
  logoRing: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.circle,
    padding: spacing.md,
  },
  tagline: { textAlign: 'center' },
  step: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  stepNumber: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radii.circle,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  stepText: { flexShrink: 1 },
  actions: { gap: spacing.md, marginTop: spacing.lg },
  link: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  version: { color: 'rgba(255,255,255,0.6)', marginTop: spacing.md, textAlign: 'center' },
});
