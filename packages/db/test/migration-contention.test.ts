import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrate.js'

const databaseUrl =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

/**
 * Regression for verify #232: parallel `runMigrations` in many beforeAll hooks
 * must not queue on the advisory lock when nothing is left to apply.
 */
describe('runMigrations under parallel load', () => {
  it('completes 32 concurrent calls within 5s when fully migrated', async () => {
    await runMigrations(databaseUrl)

    const started = performance.now()
    await Promise.all(Array.from({ length: 32 }, () => runMigrations(databaseUrl)))
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(5_000)
  })
})
