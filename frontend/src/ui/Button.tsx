import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { borderWidth, colors, layout, radii, spacing } from '@/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** Ícono (Ionicons) a la izquierda del texto. */
  icon?: string;
  accessibilityHint?: string;
  testID?: string;
};

const palette: Record<Variant, { bg: string; fg: keyof typeof colors; border?: string }> = {
  primary: { bg: colors.primary, fg: 'surface' },
  // Naranja solo como fondo: el texto va en azul oscuro para mantener el contraste.
  accent: { bg: colors.accent, fg: 'primary' },
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
  icon,
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
          minHeight: variant === 'primary' || variant === 'accent' || variant === 'danger' ? layout.buttonHeight : layout.minTouch,
          borderColor: border ?? 'transparent',
        },
        inactive ? styles.inactive : null,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={colors[fg]} /> : null}
        {icon && !loading ? (
          <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={colors[fg]} accessibilityElementsHidden />
        ) : null}
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
