import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderWidth, colors, layout, radii, spacing } from '@/theme';
import { AppText } from './AppText';
import { BrandMark } from './BrandMark';
import { PressableScale } from './PressableScale';

type Props = {
  /** Muestra la flecha de volver (ícono) a la izquierda de la marca. */
  onBack?: () => void;
  actionLabel?: string;
  /** Ícono (Ionicons) a la izquierda del texto de la acción. */
  actionIcon?: string;
  onAction?: () => void;
  /** Sobre fondo azul: marca y acción en blanco. */
  onDark?: boolean;
};

export function AppHeader({ onBack, actionLabel, actionIcon, onAction, onDark = false }: Props) {
  const ink = onDark ? colors.surface : colors.primary;
  return (
    <View style={styles.row}>
      <View style={styles.brand}>
        {onBack ? (
          <PressableScale
            haptic="tap"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[styles.back, onDark ? styles.backOnDark : null]}
          >
            <Ionicons name="arrow-back" size={22} color={ink} />
          </PressableScale>
        ) : null}
        <BrandMark size={layout.logoSize} />
        <AppText variant="heading" color={onDark ? 'surface' : 'primary'} accessibilityRole="header">
          TuTranqui
        </AppText>
      </View>
      {actionLabel && onAction ? (
        <PressableScale
          haptic="tap"
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[styles.pill, onDark ? styles.pillOnDark : null]}
        >
          {actionIcon ? (
            <Ionicons name={actionIcon as keyof typeof Ionicons.glyphMap} size={18} color={ink} accessibilityElementsHidden />
          ) : null}
          <AppText variant="labelStrong" color={onDark ? 'surface' : 'primary'}>
            {actionLabel}
          </AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.sm },
  brand: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  // Círculo suave alrededor de la flecha: se ve como botón y no como adorno.
  back: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radii.circle,
    borderWidth: borderWidth.hairline,
    height: layout.minTouch - 4,
    justifyContent: 'center',
    width: layout.minTouch - 4,
  },
  backOnDark: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'transparent' },
  pill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radii.circle,
    borderWidth: borderWidth.hairline,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: layout.minTouch - 4,
    paddingHorizontal: spacing.lg,
  },
  pillOnDark: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'transparent' },
});
