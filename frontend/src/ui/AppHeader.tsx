import { StyleSheet, View } from 'react-native';
import { spacing } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';

type Props = { actionLabel?: string; onAction?: () => void };

export function AppHeader({ actionLabel, onAction }: Props) {
  return (
    <View style={styles.row}>
      <AppText variant="heading" color="primary" accessibilityRole="header">
        TuTranqui
      </AppText>
      {actionLabel && onAction ? <Button label={actionLabel} variant="ghost" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.sm },
});
