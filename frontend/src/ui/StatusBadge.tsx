import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '@/theme';
import { AppText } from './AppText';

export type PaymentStatus =
  | 'AWAITING_CONFIRMATION'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

const STATUS: Record<
  PaymentStatus,
  { text: string; color: keyof typeof colors; icon: keyof typeof Ionicons.glyphMap }
> = {
  AWAITING_CONFIRMATION: { text: 'Esperando su confirmación', color: 'textMuted', icon: 'time-outline' },
  PROCESSING: { text: 'Enviando el pago…', color: 'primary', icon: 'sync-outline' },
  COMPLETED: { text: 'Pago exitoso', color: 'success', icon: 'checkmark-circle' },
  FAILED: { text: 'El pago no se pudo hacer', color: 'danger', icon: 'close-circle' },
  CANCELLED: { text: 'Usted canceló el pago', color: 'textMuted', icon: 'remove-circle-outline' },
  EXPIRED: { text: 'Se venció el tiempo para confirmar', color: 'textMuted', icon: 'hourglass-outline' },
};

export function paymentStatusText(status: PaymentStatus): string {
  return STATUS[status].text;
}

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const { text, color, icon } = STATUS[status];
  return (
    <View accessible accessibilityLabel={`Estado: ${text}`} style={styles.badge}>
      <Ionicons name={icon} size={20} color={colors[color]} accessibilityElementsHidden />
      <AppText variant="label" color={color} style={styles.text}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.chip,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  text: { fontWeight: '600' },
});
