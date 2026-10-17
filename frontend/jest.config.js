module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transform: { '\\.mjs$': 'babel-jest' },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/tests/msw/', '/tests/utils/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|standard-navigation|msw|@mswjs/.*|until-async|rettime|@open-draft/.*|strict-event-emitter|outvariant|headers-polyfill|is-node-process))',
  ],
};
