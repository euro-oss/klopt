import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are forward-only (spec 12). Never edit a generated migration that
 * has run anywhere; add another one.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://klopt:klopt@localhost:5432/klopt',
  },
  strict: true,
  verbose: true,
})
