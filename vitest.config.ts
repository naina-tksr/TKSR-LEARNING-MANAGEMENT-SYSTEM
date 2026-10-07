import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Each test file uses its own temporary SQLite database, so files can run
    // in parallel without contending for shared state.
    fileParallelism: true,
  },
})
