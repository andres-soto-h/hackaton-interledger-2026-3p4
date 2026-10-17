import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii } from '@/theme';
import { PressableScale } from '@/ui';
import type { VoiceStatus } from './use-voice-input';

type Props = { status: VoiceStatus; onStart: () => void; onStop: () => void };

/** Micrófono con aro naranja: toca para hablar, vuelve a tocar para terminar. */
export function MicButton({ status, onStart, onStop }: Props) {
  const listening = status === 'listening';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Ya terminé de hablar' : 'Hablar'}
      accessibilityHint={listening ? undefined : 'Dígale al asistente qué quiere pagar'}
      haptic="tap"
      scaleTo={0.92}
      onPress={listening ? onStop : onStart}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[styles.ring, listening ? styles.ringActive : null]}
    >
      <View style={[styles.button, listening ? styles.buttonActive : null]}>
        <Ionicons name={listening ? 'stop' : 'mic'} size={26} color={colors.surface} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    borderColor: colors.accent,
    borderRadius: radii.circle,
    borderWidth: 3,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  ringActive: { borderColor: colors.danger },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.circle,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  buttonActive: { backgroundColor: colors.danger },
});
