import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout } from '@/theme';

/**
 * Contenedor a pantalla completa con área segura y ancho máximo centrado
 * (web/tablet). Para pantallas que renderizan su propio scroll (listas, chat),
 * en lugar del `Screen` que ya incluye `ScrollView`.
 */
export function ScreenShell({ style, children, ...rest }: ViewProps) {
  return (
    <SafeAreaView style={styles.root} {...rest}>
      <View style={[styles.column, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  column: { alignSelf: 'center', flex: 1, maxWidth: layout.maxContentWidth, width: '100%' },
});
