import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderWidth, colors, layout, radii, shadows, spacing } from '@/theme';
import { AppText } from './AppText';
import { IconBadge } from './IconBadge';
import { PressableScale } from './PressableScale';

type Props = { name: string; subtitle: string; onPress: () => void; icon?: string };

export function MerchantTile({ name, subtitle, onPress, icon }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${subtitle}`}
      onPress={onPress}
      haptic="tap"
      style={styles.tile}
    >
      {icon ? (
        <IconBadge name={icon} />
      ) : (
        <View style={styles.badge}>
          <AppText variant="heading" color="primary">
            {name.trim().charAt(0).toUpperCase()}
          </AppText>
        </View>
      )}
      <View style={styles.text}>
        <AppText variant="bodyStrong">{name}</AppText>
        <AppText variant="caption" color="textMuted">
          {subtitle}
        </AppText>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.textMuted}
        style={styles.chevron}
        accessibilityElementsHidden
      />
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
    ...shadows.card,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radii.circle,
    height: layout.avatarSize,
    justifyContent: 'center',
    width: layout.avatarSize,
  },
  text: { flexShrink: 1, flexGrow: 1 },
  chevron: { marginLeft: 'auto' },
});
