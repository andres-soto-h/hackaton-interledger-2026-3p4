/* eslint-disable @typescript-eslint/no-require-imports -- los factories de jest.mock se evalúan con hoisting y usan require */
import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Las fuentes de íconos usan el registro de assets de Expo, que no existe en Jest.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// Haptics es un módulo nativo: en tests no vibra y no debe fallar.
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Reanimated corre sobre un motor nativo: en Jest lo sustituimos por un mock ligero.
jest.mock('react-native-reanimated', () => require('./mocks/reanimated-mock'));
// `expo-router/testing-library` re-mockea `react-native-reanimated` con el mock
// oficial, que en v4.7.1 lanza "setCSSEventHandler is not available" y devuelve
// `{}`. Al mockear también `react-native-reanimated/mock` (lo que usa su factory),
// su mock termina devolviendo nuestro mock ligero en lugar de `{}`.
jest.mock('react-native-reanimated/mock', () => require('./mocks/reanimated-mock'));

// FlashList v2 requiere la nueva arquitectura (solo en producción). En Jest se
// renderiza como FlatList, que es lo que ya se probaba.
jest.mock('@shopify/flash-list', () => {
  const { FlatList } = require('react-native');
  return { FlashList: FlatList };
});
