import { runMigrations } from '../src/migrate.js'

const databaseUrl =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

/**
 * Runs once before any db/web worker starts so parallel `beforeAll` hooks do
 * not race on first migrate. Per-file hooks call `assertTestMigrationsApplied`
 * instead, which verifies checksums without the advisory lock.
 */
export default async function globalSetup(): Promise<void> {
  await runMigrations(databaseUrl)
}
