import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, radii } from '@/theme';

type Props = { state: 'listening' | 'thinking' | 'idle'; size?: number };

/** Anillo que se expande y se desvanece, en bucle: la "onda" de la escucha. */
function Ring({ active, delay, size, reduced }: { active: boolean; delay: number; size: number; reduced: boolean }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      progress.value = withTiming(0, { duration: 200 });
      return;
    }
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false),
    );
  }, [active, delay, reduced, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.5, 0]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 2.1]) }],
  }));
  return <Animated.View style={[styles.ring, { width: size, height: size }, style]} />;
}

/** Barra de la "voz": sube y baja a ritmos distintos mientras se escucha. */
function Bar({ active, index, reduced }: { active: boolean; index: number; reduced: boolean }) {
  const level = useSharedValue(0.25);
  useEffect(() => {
    if (!active || reduced) {
      level.value = withTiming(0.25, { duration: 200 });
      return;
    }
    const high = 0.55 + ((index * 37) % 45) / 100;
    level.value = withDelay(
      index * 90,
      withRepeat(
        withSequence(
          withTiming(high, { duration: 320 + index * 40, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.25, { duration: 320 + index * 40, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [active, index, reduced, level]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: level.value }] }));
  return <Animated.View style={[styles.bar, style]} />;
}

/**
 * Orbe del asistente (como Siri o Gemini): ondas mientras escucha, barras de voz
 * dentro del orbe, y un pulso suave cuando está pensando. Respeta "reducir movimiento".
 */
export function ListeningOrb({ state, size = 76 }: Props) {
  const reduced = useReducedMotion();
  const listening = state === 'listening';
  const thinking = state === 'thinking';
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!thinking || reduced) {
      pulse.value = withTiming(1, { duration: 200 });
      return;
    }
    pulse.value = withRepeat(
      withSequence(withTiming(1.12, { duration: 600 }), withTiming(1, { duration: 600 })),
      -1,
      false,
    );
  }, [thinking, reduced, pulse]);
  const coreStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <View
      style={[styles.wrap, { width: size * 2.2, height: size * 2.2 }]}
      accessible
      accessibilityLabel={listening ? 'Le estoy escuchando' : thinking ? 'Pensando' : 'Asistente'}
      accessibilityLiveRegion="polite"
    >
      {[0, 600, 1200].map((delay) => (
        <Ring key={delay} active={listening} delay={delay} size={size} reduced={reduced} />
      ))}
      <Animated.View style={[styles.core, { width: size, height: size }, coreStyle]}>
        {listening ? (
          <View style={styles.bars}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Bar key={i} active index={i} reduced={reduced} />
            ))}
          </View>
        ) : (
          <Ionicons name={thinking ? 'ellipsis-horizontal' : 'mic'} size={size * 0.42} color={colors.surface} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { backgroundColor: colors.accent, borderRadius: radii.circle, position: 'absolute' },
  core: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.accent,
    borderRadius: radii.circle,
    borderWidth: 4,
    justifyContent: 'center',
  },
  bars: { alignItems: 'center', flexDirection: 'row', gap: 4, height: 32 },
  bar: { backgroundColor: colors.surface, borderRadius: 3, height: 32, width: 5 },
});
