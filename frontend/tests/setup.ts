import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Las fuentes de íconos usan el registro de assets de Expo, que no existe en Jest.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
