import { closeDatabase, createDatabase, withOAuth } from '@klopt/db'

/**
 * Deleting authorization codes that can no longer be redeemed (spec 10.3).
 *
 * A code lives sixty seconds and is refused after that whether or not the row
 * is still there, so this is housekeeping rather than a security control — the
 * expiry check is in `checkRedemption` and does not depend on this having run.
 *
 * It is worth running anyway. Every connection attempt leaves a row, including
 * the ones nobody completed, and a table that only grows is one somebody finds
 * at a million rows and has to reason about under pressure.
 *
 * A day's grace before deleting, so a code that failed can still be looked up
 * while somebody is asking why. `code_already_used` is the interesting case —
 * a redeemed code being presented twice means it leaked — and that
 * investigation happens the morning after, not within the minute.
 */
const GRACE_MS = 24 * 60 * 60 * 1000

export async function purgeExpiredCodesJob(databaseUrl: string): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 2 })
  try {
    const before = new Date(Date.now() - GRACE_MS)
    const removed = await withOAuth(database, (repository) => repository.purgeExpiredCodes(before))

    if (removed > 0) {
      console.info(`[worker] oauth: ${String(removed)} verlopen autorisatiecode(s) opgeruimd`)
    }
  } finally {
    await closeDatabase(database)
  }
}
