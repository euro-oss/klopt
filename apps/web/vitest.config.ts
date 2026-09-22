import { defineConfig } from 'vitest/config'

// Deliberately not vite.config.ts: the contract test must not need the whole
// Start plugin pipeline to run.
export default defineConfig({
  test: {
    name: 'web',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Runs before every test file: guarantees an encryption key is present for
    // the suites that store secrets, without depending on the shell or the file
    // order. See the file for why this is not a single ambient variable.
    setupFiles: ['./test/setup/environment.ts'],
  },
})
