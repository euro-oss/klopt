import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'example-notifier',
    include: ['test/**/*.test.ts'],
  },
})
