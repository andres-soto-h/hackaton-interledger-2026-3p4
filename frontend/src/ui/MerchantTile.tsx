import { Pressable, StyleSheet, View } from 'react-native';
import { colors, layout, radii, spacing } from '@/theme';
import { AppText } from './AppText';

type Props = { name: string; subtitle: string; onPress: () => void };

export function MerchantTile({ name, subtitle, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${subtitle}`}
      onPress={onPress}
      style={styles.tile}
    >
      <View style={styles.badge}>
        <AppText variant="heading" color="primary">
          {name.trim().charAt(0).toUpperCase()}
        </AppText>
      </View>
      <View style={styles.text}>
        <AppText variant="bodyStrong">{name}</AppText>
        <AppText variant="caption" color="textMuted">
          {subtitle}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: layout.buttonHeight + spacing.lg,
    padding: spacing.lg,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.chip,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  text: { flexShrink: 1 },
});
