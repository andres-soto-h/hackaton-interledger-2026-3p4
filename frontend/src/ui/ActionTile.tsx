import { StyleSheet, View } from 'react-native';
import { borderWidth, colors, radii, shadows, spacing } from '@/theme';
import { AppText } from './AppText';
import { IconBadge } from './IconBadge';
import { PressableScale } from './PressableScale';

type Props = {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  /** Borde punteado: acción para agregar algo nuevo. */
  dashed?: boolean;
};

/** Atajo grande con ícono, pensado para una cuadrícula de dos columnas. */
export function ActionTile({ icon, title, subtitle, onPress, dashed = false }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      haptic="tap"
      style={[styles.tile, dashed ? styles.dashed : null]}
    >
      <IconBadge name={icon} size={40} tone={dashed ? 'accent' : 'primary'} />
      <View style={styles.text}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color="textMuted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.md,
    minHeight: 112,
    padding: spacing.lg,
    ...shadows.card,
  },
  dashed: { backgroundColor: 'transparent', borderColor: colors.textMuted, borderStyle: 'dashed' },
  text: { gap: 2 },
});
