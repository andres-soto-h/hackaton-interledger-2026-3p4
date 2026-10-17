import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii } from '@/theme';

type Tone = 'primary' | 'accent' | 'success' | 'danger';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  primary: { bg: colors.primarySoft, fg: colors.primary },
  accent: { bg: colors.accentSoft, fg: colors.primary },
  success: { bg: colors.successSoft, fg: colors.success },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

type Props = {
  name: string;
  size?: number;
  tone?: Tone;
  /** Círculo sólido con el ícono en blanco (para resultados). */
  solid?: boolean;
};

/** Ícono dentro de un círculo de color: decorativo, nunca la única señal. */
export function IconBadge({ name, size = 44, tone = 'primary', solid = false }: Props) {
  const { bg, fg } = TONES[tone];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.badge,
        { width: size, height: size, backgroundColor: solid ? fg : bg },
      ]}
    >
      <Ionicons
        name={name as keyof typeof Ionicons.glyphMap}
        size={Math.round(size * 0.5)}
        color={solid ? colors.surface : fg}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', borderRadius: radii.circle, justifyContent: 'center' },
});
