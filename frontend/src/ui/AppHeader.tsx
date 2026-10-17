import { Image, StyleSheet, View } from 'react-native';
import { layout, radii, spacing } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';

type Props = { actionLabel?: string; onAction?: () => void };

export function AppHeader({ actionLabel, onAction }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.brand}>
        <Image
          source={require('../../assets/logo-app-tranqui.jpeg')}
          style={styles.logo}
          resizeMode="cover"
          accessible={false}
        />
        <AppText variant="heading" color="primary" accessibilityRole="header">
          TuTranqui
        </AppText>
      </View>
      {actionLabel && onAction ? <Button label={actionLabel} variant="ghost" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.sm },
  brand: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  // La imagen es cuadrada: `borderRadius` grande la recorta como círculo.
  logo: { width: layout.logoSize, height: layout.logoSize, borderRadius: radii.circle },
});
