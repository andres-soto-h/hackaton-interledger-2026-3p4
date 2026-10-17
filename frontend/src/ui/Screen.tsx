import { Platform, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout, spacing } from '@/theme';

type Props = ViewProps & { scroll?: boolean; tone?: 'light' | 'dark' };

/** Fondo, márgenes, área segura y, en web, contenido centrado a 480 px como máximo. */
export function Screen({ children, scroll = true, tone = 'light', testID, style, ...rest }: Props) {
  const content = (
    <View
      testID={testID ? `${testID}-content` : undefined}
      style={[styles.content, Platform.OS === 'web' ? styles.webWidth : null, style]}
      {...rest}
    >
      {children}
    </View>
  );
  return (
    <SafeAreaView testID={testID} style={[styles.root, tone === 'dark' ? styles.dark : null]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {content}
        </ScrollView>
      ) : (
        <View style={styles.scroll}>{content}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1 },
  dark: { backgroundColor: colors.primary },
  scroll: { alignItems: 'center', flexGrow: 1 },
  content: { flexGrow: 1, gap: spacing.lg, paddingHorizontal: layout.screenMargin, paddingVertical: spacing.xl },
  webWidth: { maxWidth: layout.maxContentWidth, width: '100%' },
});
