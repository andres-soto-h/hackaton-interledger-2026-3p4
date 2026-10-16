import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Synthesizing CDK stacks is slower than a typical unit test.
    testTimeout: 30_000
  }
})
