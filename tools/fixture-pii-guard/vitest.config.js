import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'fixture-pii-guard',
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
})
