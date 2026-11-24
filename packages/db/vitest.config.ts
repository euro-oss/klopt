import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // One shared CI Postgres (max_connections=100). Cap workers so file-level
    // pools (max 4 each) cannot exhaust connections or lock each other out.
    maxWorkers: 3,
    teardownTimeout: 15_000,
    // DB-heavy suites run against a real Postgres; on a busy CI runner the
    // 5 s default timed out tests that pass locally (verify 24/26 flakes).
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
