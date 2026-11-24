import { defineConfig } from 'vitest/config'

// Bank-match tests include a GUC-gated audit rollback case; run this file on
// one worker so it does not contend with other suites on klopt.audit_log.
export default defineConfig({
  test: {
    name: 'web-matching',
    include: ['test/matching.test.ts'],
    environment: 'node',
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    teardownTimeout: 15_000,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    setupFiles: ['./test/setup/environment.ts'],
  },
})
