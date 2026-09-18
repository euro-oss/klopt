import { defineConfig } from 'vitest/config'

// Deliberately not vite.config.ts: the contract test must not need the whole
// Start plugin pipeline to run.
export default defineConfig({
  test: {
    name: 'web',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./test/setup/environment.ts'],
  },
})
