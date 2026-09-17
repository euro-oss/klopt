import { closeDatabase, createDatabase, type Database } from '../../src/client.js'
import { runMigrations } from '../../src/migrate.js'
import { seedEntity, type SeedOptions } from '../../src/testing.js'

/**
 * A database plus a freshly seeded entity.
 *
 * Each test gets its own entity rather than a truncated database. Tests then
 * run concurrently, and — more usefully — every assertion is implicitly also
 * asserting that entity scoping works, because a leak would surface as another
 * test's data.
 */

export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

export interface Fixture {
  readonly database: Database
  readonly entityId: string
  readonly close: () => Promise<void>
}

let migrated = false

export async function createFixture(options: SeedOptions = {}): Promise<Fixture> {
  if (!migrated) {
    await runMigrations(TEST_DATABASE_URL)
    migrated = true
  }

  const database = createDatabase({ url: TEST_DATABASE_URL, maxConnections: 4 })
  const entityId = await seedEntity(database, options)

  return { database, entityId, close: () => closeDatabase(database) }
}

export { seedEntity }
