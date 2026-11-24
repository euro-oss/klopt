import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrate.js'
import { assertTestMigrationsApplied } from './support/ensure-test-migrations.js'

const databaseUrl =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

/**
 * Regression for verify #232: parallel per-file setup must not queue on
 * pg_advisory_lock when globalSetup and CI Migrate already applied everything.
 */
describe('assertTestMigrationsApplied under parallel load', () => {
  it('completes 32 concurrent calls within 5s when fully migrated', async () => {
    await runMigrations(databaseUrl)

    const started = performance.now()
    await Promise.all(Array.from({ length: 32 }, () => assertTestMigrationsApplied(databaseUrl)))
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(5_000)
  })
})
