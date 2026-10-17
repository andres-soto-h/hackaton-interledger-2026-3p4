import { StyleSheet, View } from 'react-native';
import { borderWidth, colors, layout, radii, spacing } from '@/theme';
import { formatMoney } from '@/lib/money';
import { AppText, PressableScale, StatusBadge, paymentStatusText } from '@/ui';
import { counterpartyName, formatRelativeDate } from '../format';
import type { Transaction } from '../types';

type Props = { transaction: Transaction; onPress?: (id: string) => void; now?: Date };

export function TransactionItem({ transaction: t, onPress, now }: Props) {
  const name = counterpartyName(t.counterparty);
  const amount = formatMoney(t.totalDebit ?? t.debitAmount);
  const when = formatRelativeDate(t.createdAt, now);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${amount}, ${when}, ${paymentStatusText(t.status)}`}
      onPress={() => onPress?.(t.id)}
      haptic="tap"
      style={styles.row}
    >
      <View style={styles.left}>
        <AppText variant="bodyStrong">{name}</AppText>
        <AppText variant="caption" color="textMuted">
          {when}
        </AppText>
        <StatusBadge status={t.status} />
      </View>
      <AppText variant="bodyStrong">{amount}</AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    borderWidth: borderWidth.hairline,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: layout.minTouch,
    padding: spacing.lg,
  },
  left: { flexShrink: 1, gap: spacing.xs },
});
