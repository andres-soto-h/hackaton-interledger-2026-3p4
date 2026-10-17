import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radii, spacing } from '@/theme';

type Props = ViewProps & { tone?: 'surface' | 'alt' };

export function Card({ tone = 'surface', style, ...rest }: Props) {
  return (
    <View
      style={[styles.card, { backgroundColor: tone === 'alt' ? colors.surfaceAlt : colors.surface }, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.card, gap: spacing.md, padding: spacing.lg },
});
