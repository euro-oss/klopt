import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // DB-heavy suites run against a real Postgres; on a busy CI runner the
    // 5 s default timed out tests that pass locally (verify 24/26 flakes).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
