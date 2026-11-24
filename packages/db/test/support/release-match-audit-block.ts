import { sql } from 'drizzle-orm'
import type { Database } from '../../src/client.js'

let blockReleaseMatchAudit = false

/**
 * Prepends `SET LOCAL klopt.test_block_release_match_audit = on` to every
 * Drizzle transaction while {@link withBlockedReleaseMatchAudit} runs, so the
 * GUC-gated trigger installed in globalSetup can fail the next
 * `bank.releaseMatch` audit insert without CREATE/DROP on klopt.audit_log.
 */
export function wrapDatabaseForAuditBlockTests(database: Database): Database {
  const originalTransaction = database.transaction.bind(database)
  database.transaction = (callback, config) =>
    originalTransaction(async (tx) => {
      if (blockReleaseMatchAudit) {
        await tx.execute(sql`select set_config('klopt.test_block_release_match_audit', 'on', true)`)
      }
      return callback(tx)
    }, config)
  return database
}

export async function withBlockedReleaseMatchAudit(run: () => Promise<void>): Promise<void> {
  blockReleaseMatchAudit = true
  try {
    await run()
  } finally {
    blockReleaseMatchAudit = false
  }
}