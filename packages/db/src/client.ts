import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

export interface DatabaseConfig {
  readonly url: string
  readonly maxConnections?: number
}

export type Database = PostgresJsDatabase<typeof schema>

/**
 * A transaction handle. Repositories take one of these rather than the pool,
 * so it is not possible to write half a posting: if you have a repository, you
 * are already inside a transaction.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export function createDatabase(config: DatabaseConfig): Database {
  const sql = postgres(config.url, {
    max: config.maxConnections ?? 10,
    // Postgres renders bigint as a string and postgres.js would hand it back
    // as one. Parsing to BigInt here means no money value is ever a JS number,
    // not even briefly.
    types: {
      bigint: postgres.BigInt,
    },
  })

  return drizzle(sql, { schema })
}

/** Closes the pool. Only a process shutting down should call this. */
export async function closeDatabase(database: Database): Promise<void> {
  const client = (database as unknown as { $client: postgres.Sql }).$client
  await client.end({ timeout: 5 })
}
