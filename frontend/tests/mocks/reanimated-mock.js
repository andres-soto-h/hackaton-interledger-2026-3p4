// Mock ligero de `react-native-reanimated` para Jest.
// `createAnimatedComponent` devuelve el componente tal cual: en tests no se anima,
// solo se verifica la estructura y la accesibilidad.
'use strict';
const { View, Pressable, ScrollView, FlatList, Text, Image } = require('react-native');

const createAnimatedComponent = (Component) => Component;

const Animated = { createAnimatedComponent, View, Pressable, ScrollView, FlatList, Text, Image };

module.exports = {
  __esModule: true,
  default: Animated,
  createAnimatedComponent,
  useSharedValue: (v) => ({ value: v }),
  useDerivedValue: (v) => ({ value: typeof v === 'function' ? undefined : v }),
  useAnimatedStyle: () => ({}),
  useAnimatedProps: () => ({}),
  useAnimatedRef: () => ({ current: null }),
  useScrollViewOffset: () => ({ value: 0 }),
  withSpring: (v) => v,
  withTiming: (v) => v,
  withRepeat: (v) => v,
  withSequence: (v) => v,
  withDelay: (_ms, v) => v,
  runOnJS: (fn) => fn,
  interpolate: (v) => v,
  Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  Easing: { linear: () => 1, inOut: () => 1 },
  FadeIn: () => ({}),
  FadeOut: () => ({}),
  SlideInUp: () => ({}),
  SlideOutDown: () => ({}),
};
