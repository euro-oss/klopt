import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'rgs-import', include: ['test/**/*.test.ts'], environment: 'node' },
})
