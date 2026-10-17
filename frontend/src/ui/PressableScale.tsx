/* eslint-disable react-hooks/immutability -- el SharedValue de Reanimated se muta por diseño */
import { Pressable, type PressableProps } from 'react-native';
import { createAnimatedComponent, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { hapticSelection, hapticTap } from './haptics';

const AnimatedPressable = createAnimatedComponent(Pressable);

const SPRING = { damping: 16, stiffness: 260, mass: 0.6 };

export type HapticKind = 'tap' | 'selection' | null;

type Props = PressableProps & {
  /** Escala al presionar (micro-interacción). Por omisión 0.97. */
  scaleTo?: number;
  /** Haptic al presionar: `tap` (botones) o `selection` (chips/filtros). */
  haptic?: HapticKind;
};

/**
 * `Pressable` con micro-interacción de escala (Reanimated) y haptic opcional.
 * Sustituye a `Pressable`/`TouchableOpacity` en toda la app para un tacto
 * consistente a 60 fps. `style` debe ser estático (no una función): el estado
 * "presionado" se comunica con la escala, no con opacidad.
 */
export function PressableScale({
  scaleTo = 0.97,
  haptic = null,
  onPressIn,
  onPressOut,
  style,
  children,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn: PressableProps['onPressIn'] = (event) => {
    scale.value = withSpring(scaleTo, SPRING);
    if (haptic === 'tap') void hapticTap();
    else if (haptic === 'selection') void hapticSelection();
    onPressIn?.(event);
  };

  const handlePressOut: PressableProps['onPressOut'] = (event) => {
    scale.value = withSpring(1, SPRING);
    onPressOut?.(event);
  };

  return (
    <AnimatedPressable onPressIn={handlePressIn} onPressOut={handlePressOut} style={[animatedStyle, style]} {...rest}>
      {children}
    </AnimatedPressable>
  );
}
