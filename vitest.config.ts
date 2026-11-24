import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Vitest 5 refuses projects with different maxWorkers in one
    // sequence.groupOrder; pin it here so the default never depends on CPUs.
    maxWorkers: 3,
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      'apps/web/vitest.matching.config.ts',
      'tools/*/vitest.config.js',
      'examples/*/vitest.config.ts',
    ],
  },
})
