import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout, radii, spacing } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { PressableScale } from './PressableScale';

type Props = {
  /** Muestra la flecha de volver (ícono) a la izquierda de la marca. */
  onBack?: () => void;
  actionLabel?: string;
  onAction?: () => void;
};

export function AppHeader({ onBack, actionLabel, onAction }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.brand}>
        {onBack ? (
          <PressableScale
            haptic="tap"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.back}
          >
            <Ionicons name="arrow-back" size={24} color={colors.primary} />
          </PressableScale>
        ) : null}
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
  back: { alignItems: 'center', height: layout.minTouch, justifyContent: 'center', width: layout.minTouch },
  // La imagen es cuadrada: `borderRadius` grande la recorta como círculo.
  logo: { width: layout.logoSize, height: layout.logoSize, borderRadius: radii.circle },
});
