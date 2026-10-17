import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { AppText } from './AppText';

type Props = { label: string; detail?: string; value: string; strong?: boolean };

export function AmountRow({ label, detail, value, strong = false }: Props) {
  const spoken = `${label}${detail ? `, ${detail}` : ''}: ${value}`;
  return (
    <View accessible accessibilityLabel={spoken} style={styles.row}>
      <View style={styles.left}>
        <AppText variant={strong ? 'bodyStrong' : 'body'}>{label}</AppText>
        {detail ? (
          <AppText variant="caption" color="textMuted">
            {detail}
          </AppText>
        ) : null}
      </View>
      <AppText variant="bodyStrong" style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  left: { flexShrink: 1 },
  value: { textAlign: 'right' },
});
