import { StyleSheet, View } from 'react-native';
import { borderWidth, colors, radii, spacing } from '@/theme';
import { AppText } from '@/ui';

/** El texto del agente es siempre texto plano: ni HTML, ni markdown, ni enlaces que se abran solos. */
export function AgentBubble({ text, pending }: { text: string; pending?: boolean }) {
  return (
    <View style={[styles.bubble, styles.agent]} accessibilityLabel={`TuTranqui dice: ${pending ? 'escribiendo' : text}`} accessible>
      <AppText variant="caption" color="textMuted">
        TuTranqui dice
      </AppText>
      <AppText selectable={false}>{pending ? 'escribiendo…' : text}</AppText>
    </View>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <View style={[styles.bubble, styles.user]} accessibilityLabel={`Usted dijo: ${text}`} accessible>
      <AppText variant="caption" color="textMuted">
        Usted dijo
      </AppText>
      <AppText>{text}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { borderRadius: radii.bubble, gap: spacing.xs, maxWidth: '88%', padding: spacing.md },
  agent: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderTopLeftRadius: radii.bubbleTip,
    borderWidth: borderWidth.hairline,
  },
  user: { alignSelf: 'flex-end', backgroundColor: colors.surfaceAlt, borderTopRightRadius: radii.bubbleTip },
});
