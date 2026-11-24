import { defineConfig } from 'vitest/config'

// Deliberately not vite.config.ts: the contract test must not need the whole
// Start plugin pipeline to run.
export default defineConfig({
  test: {
    name: 'web',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // DB-heavy suites run against a real Postgres; on a busy CI runner the
    // default hook budget timed out in beforeAll on slow verify (24) jobs.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Runs before every test file: guarantees an encryption key is present for
    // the suites that store secrets, without depending on the shell or the file
    // order. See the file for why this is not a single ambient variable.
    setupFiles: ['./test/setup/environment.ts'],
  },
})
