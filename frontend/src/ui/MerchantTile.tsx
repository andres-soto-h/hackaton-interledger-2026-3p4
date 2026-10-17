import { StyleSheet, View } from 'react-native';
import { borderWidth, colors, layout, radii, spacing } from '@/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

type Props = { name: string; subtitle: string; onPress: () => void };

export function MerchantTile({ name, subtitle, onPress }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${subtitle}`}
      onPress={onPress}
      haptic="tap"
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
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: layout.buttonHeight + spacing.lg,
    padding: spacing.lg,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.chip,
    height: layout.avatarSize,
    justifyContent: 'center',
    width: layout.avatarSize,
  },
  text: { flexShrink: 1 },
});
