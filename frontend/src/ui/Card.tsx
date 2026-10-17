import { StyleSheet, View, type ViewProps } from 'react-native';
import { borderWidth, colors, radii, shadows, spacing } from '@/theme';

type Props = ViewProps & { tone?: 'surface' | 'alt' };

export function Card({ tone = 'surface', style, ...rest }: Props) {
  return (
    <View
      style={[styles.card, tone === 'alt' ? styles.alt : styles.surface, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.card,
  },
  surface: { backgroundColor: colors.surface, borderColor: colors.borderSubtle },
  alt: { backgroundColor: colors.surfaceAlt, borderColor: 'transparent' },
});
