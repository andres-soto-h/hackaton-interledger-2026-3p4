import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, iconSize, spacing } from '@/theme';
import { AppText } from './AppText';

export type CheckStatus = 'pending' | 'ok' | 'warning' | 'error';

const META: Record<CheckStatus, { icon: keyof typeof Ionicons.glyphMap; color: keyof typeof colors; word: string }> = {
  pending: { icon: 'ellipse-outline', color: 'textMuted', word: 'revisando' },
  ok: { icon: 'checkmark-circle', color: 'success', word: 'correcto' },
  warning: { icon: 'alert-circle', color: 'danger', word: 'atención' },
  error: { icon: 'close-circle', color: 'danger', word: 'con problema' },
};

/** Ítem de validación: ícono + texto, nunca solo color. */
export function CheckItem({ title, detail, status }: { title: string; detail?: string; status: CheckStatus }) {
  const { icon, color, word } = META[status];
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${word}${detail ? `. ${detail}` : ''}`}
      style={styles.row}
    >
      <Ionicons name={icon} size={iconSize.lg} color={colors[color]} accessibilityElementsHidden />
      <View style={styles.text}>
        <AppText variant="body">{title}</AppText>
        {detail ? (
          <AppText variant="caption" color={status === 'ok' ? 'textMuted' : 'danger'}>
            {detail}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  text: { flexShrink: 1 },
});
