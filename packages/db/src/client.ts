/**
 * Database client. One pool per process; the worker and the web app each make
 * their own.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

export interface DatabaseConfig {
  readonly url: string
  readonly maxConnections?: number
}

export function createDatabase(config: DatabaseConfig) {
  const sql = postgres(config.url, {
    max: config.maxConnections ?? 10,
    // Money never becomes a float on the way out, not even by accident.
    types: {
      bigint: postgres.BigInt,
    },
  })

  return drizzle(sql, { schema })
}

export type Database = ReturnType<typeof createDatabase>
