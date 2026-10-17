import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { borderWidth, colors, layout, radii, spacing } from '@/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

const palette: Record<Variant, { bg: string; fg: keyof typeof colors; border?: string }> = {
  primary: { bg: colors.primary, fg: 'surface' },
  secondary: { bg: colors.surface, fg: 'primary', border: colors.primary },
  ghost: { bg: 'transparent', fg: 'primary' },
  danger: { bg: colors.danger, fg: 'surface' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
  testID,
}: Props) {
  const inactive = disabled || loading;
  const { bg, fg, border } = palette[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      haptic="tap"
      style={[
        styles.base,
        {
          backgroundColor: bg,
          minHeight: variant === 'primary' || variant === 'danger' ? layout.buttonHeight : layout.minTouch,
          borderColor: border ?? 'transparent',
        },
        inactive ? styles.inactive : null,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={colors[fg]} /> : null}
        <AppText variant="bodyStrong" color={fg}>
          {label}
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.button,
    borderWidth: borderWidth.hairline,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  inactive: { opacity: 0.5 },
  content: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
});
