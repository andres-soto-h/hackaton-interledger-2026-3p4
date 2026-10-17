import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AssistantSheet } from '@/features/agent/components/AssistantSheet';
import { authApi } from '@/features/auth/api';
import { useSession } from '@/features/auth/session';
import { TransactionItem } from '@/features/transactions/components/TransactionItem';
import { useRecentTransactions } from '@/features/transactions/hooks';
import { LinkWalletBanner } from '@/features/wallet-link/components/LinkWalletBanner';
import { formatMoney } from '@/lib/money';
import { borderWidth, colors, radii, shadows, spacing } from '@/theme';
import {
  ActionTile,
  AppHeader,
  AppText,
  BrandMark,
  Button,
  EmptyState,
  ErrorState,
  PressableScale,
  Screen,
} from '@/ui';

export default function Home() {
  const router = useRouter();
  const { user } = useSession();
  const recent = useRecentTransactions();
  const allowance = useQuery({ queryKey: ['me', 'allowance'], queryFn: authApi.getAllowance });
  const items = recent.data?.pages.flatMap((p) => p.items) ?? [];
  const firstName = user?.displayName.split(' ')[0] ?? '';
  // El asistente se abre como panel sobre el inicio (sin cambiar de pantalla).
  const [assistant, setAssistant] = useState<null | 'voice' | 'text'>(null);

  return (
    <View style={styles.root}>
      <Screen>
        <AppHeader
          actionLabel="Mi cuenta"
          actionIcon="person-circle-outline"
          onAction={() => router.push('/cuenta')}
        />

        {allowance.data ? (
          <View
            style={styles.permit}
            accessible
            accessibilityLabel={`Permiso del banco activo. Tope ${formatMoney(allowance.data.dailyLimit)}`}
          >
            <Ionicons
              name="shield-checkmark"
              size={18}
              color={colors.success}
              accessibilityElementsHidden
            />
            <AppText variant="labelStrong" color="primary">
              Permiso del banco activo
            </AppText>
            <AppText variant="label" color="textMuted" style={styles.permitLimit}>
              {`Tope: ${formatMoney(allowance.data.dailyLimit)}`}
            </AppText>
          </View>
        ) : null}
        <LinkWalletBanner />

        <View style={styles.greeting}>
          <BrandMark size={36} />
          <View style={styles.bubble}>
            <AppText variant="heading" accessibilityRole="header">
              {`Hola, ${firstName}. ¿Qué pagamos hoy?`}
            </AppText>
          </View>
        </View>

        <View style={styles.micWrap}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Toque y dígame qué pagar"
            accessibilityHint="Abre el asistente de TuTranqui"
            haptic="tap"
            scaleTo={0.94}
            onPress={() => setAssistant('voice')}
            style={styles.micRing}
          >
            <View style={styles.mic}>
              <Ionicons name="mic" size={40} color={colors.surface} />
            </View>
          </PressableScale>
          <AppText
            variant="heading"
            color="primary"
            style={styles.micLabel}
            accessibilityElementsHidden
          >
            Toque y dígame qué pagar
          </AppText>
          <Button
            label="Prefiero escribir"
            variant="ghost"
            icon="create-outline"
            onPress={() => setAssistant('text')}
          />
        </View>

        <AppText variant="label" color="textMuted">
          O escoja dónde pagar
        </AppText>
        <View style={styles.grid}>
          <ActionTile
            icon="receipt"
            title="Pagar un servicio"
            subtitle="Luz, agua, gas…"
            onPress={() => router.push('/pagos' as never)}
          />
          <ActionTile
            icon="shield-checkmark"
            title="Comercios seguros"
            subtitle="Ya revisados"
            onPress={() => router.push('/comercios' as never)}
          />
        </View>

        <AppText variant="heading" accessibilityRole="header" style={styles.sectionTitle}>
          Últimos pagos
        </AppText>
        {recent.isLoading ? <AppText color="textMuted">Cargando sus pagos…</AppText> : null}
        {recent.isError ? (
          <ErrorState
            message="No pudimos cargar sus pagos."
            onRetry={() => recent.refetch()}
            retryLabel="Reintentar"
          />
        ) : null}
        {!recent.isLoading && !recent.isError && items.length === 0 ? (
          <EmptyState message="Todavía no ha hecho pagos" />
        ) : null}
        {items.slice(0, 5).map((t) => (
          <TransactionItem
            key={t.id}
            transaction={t}
            onPress={(id) => router.push(`/transacciones/${id}` as never)}
          />
        ))}
        {items.length > 0 ? (
          <Button
            label="Ver todas"
            variant="ghost"
            icon="list"
            onPress={() => router.push('/transacciones')}
          />
        ) : null}
      </Screen>
      {assistant ? (
        <AssistantSheet autoListen={assistant === 'voice'} onClose={() => setAssistant(null)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  permit: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radii.chip,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  permitLimit: { marginLeft: 'auto' },
  greeting: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  bubble: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radii.bubble,
    borderTopLeftRadius: radii.bubbleTip,
    borderWidth: borderWidth.hairline,
    flexShrink: 1,
    padding: spacing.lg,
    ...shadows.card,
  },
  micWrap: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  // Aro naranja alrededor del micrófono: es la acción principal del inicio.
  micRing: {
    alignItems: 'center',
    borderColor: colors.accent,
    borderRadius: radii.circle,
    borderWidth: 5,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  mic: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.circle,
    height: 92,
    justifyContent: 'center',
    width: 92,
  },
  micLabel: { textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  sectionTitle: { marginTop: spacing.sm },
});
