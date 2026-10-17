import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';

type Props = {
  question: string;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirmación en la propia pantalla (Alert no funciona igual en web y en Android). */
export function ConfirmPanel({
  question,
  confirmLabel,
  cancelLabel = 'No, volver',
  loading,
  danger,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Card tone="alt" accessibilityLiveRegion="polite">
      <AppText variant="bodyStrong">{question}</AppText>
      <View style={styles.actions}>
        <Button
          label={confirmLabel}
          variant={danger ? 'danger' : 'primary'}
          loading={loading}
          onPress={onConfirm}
        />
        <Button label={cancelLabel} variant="secondary" disabled={loading} onPress={onCancel} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({ actions: { gap: spacing.sm } });
