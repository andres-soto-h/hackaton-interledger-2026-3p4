import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@/theme';
import { AppText } from './AppText';

type Props = { step: number; total: number; name: string };

/** "Paso N de M · Nombre" con una barra de progreso sutil. */
export function StepIndicator({ step, total, name }: Props) {
  return (
    <View style={styles.wrapper}>
      <AppText variant="caption" color="textMuted" accessibilityRole="header">
        {`Paso ${step} de ${total} · ${name}`}
      </AppText>
      <View style={styles.track} accessibilityElementsHidden>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.segment, i < step ? styles.done : null]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  track: { flexDirection: 'row', gap: spacing.xs },
  segment: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.chip,
    flex: 1,
    height: spacing.xs,
  },
  done: { backgroundColor: colors.primary },
});
