import { StyleSheet, View } from 'react-native';
import { borderWidth, colors, spacing } from '@/theme';
import { AppText } from './AppText';

type Props = { label: string; detail?: string; value: string; strong?: boolean };

export function AmountRow({ label, detail, value, strong = false }: Props) {
  const spoken = `${label}${detail ? `, ${detail}` : ''}: ${value}`;
  return (
    <View accessible accessibilityLabel={spoken} style={[styles.row, strong ? styles.strongRow : null]}>
      <View style={styles.left}>
        <AppText variant={strong ? 'bodyStrong' : 'body'} color={strong ? 'text' : 'textMuted'}>
          {label}
        </AppText>
        {detail ? (
          <AppText variant="caption" color="textMuted">
            {detail}
          </AppText>
        ) : null}
      </View>
      <AppText variant={strong ? 'title' : 'bodyStrong'} style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  // El total se separa con una línea y un número grande, como en un recibo.
  strongRow: { alignItems: 'center', borderTopColor: colors.primary, borderTopWidth: borderWidth.hairline * 2, paddingTop: spacing.md },
  left: { flexShrink: 1 },
  value: { textAlign: 'right' },
});
