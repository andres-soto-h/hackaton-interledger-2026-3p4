import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.box}>
      <AppText variant="body" color="textMuted" style={styles.center}>
        {message}
      </AppText>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Intentar de nuevo',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <AppText variant="body" color="danger" style={styles.center} accessibilityRole="alert">
        {message}
      </AppText>
      {onRetry ? <Button label={retryLabel} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'stretch', gap: spacing.lg, padding: spacing.xl },
  center: { textAlign: 'center' },
});
