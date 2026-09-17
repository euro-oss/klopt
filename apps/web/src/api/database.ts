import { createDatabase, type Database } from '@klopt/db'

/**
 * The connection pool, lazily built.
 *
 * Its own module so that the auth instance and the request runtime can both
 * reach it without importing each other: `runtime → auth → auth-instance →
 * runtime` was a real cycle, and a cycle in module initialisation is the kind
 * of bug that only appears in production, under a cold start.
 */

let database: Database | null = null

export function getDatabase(): Database {
  if (database === null) {
    const url = process.env['DATABASE_URL']
    if (url === undefined || url === '') throw new Error('DATABASE_URL is not set.')
    database = createDatabase({ url })
  }
  return database
}

/** Test seam, so a suite can supply its own pool. */
export function setDatabaseForTest(value: Database | null): void {
  database = value
}
