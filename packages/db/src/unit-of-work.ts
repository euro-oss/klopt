import type { Database } from './client.js'
import { DrizzleLedgerRepository } from './repositories/ledger.js'
import { ReportingRepository } from './repositories/reporting.js'

/**
 * The only sanctioned way to get a ledger repository.
 *
 * Everything a posting does — the entry, its lines, the balance update, the
 * idempotency record, the audit row and the outbox event — commits together or
 * not at all. The transactional outbox in particular only gives its
 * at-least-once guarantee when the event shares a transaction with the state
 * change it describes.
 */
export async function withLedger<T>(
  database: Database,
  work: (repository: DrizzleLedgerRepository) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => work(new DrizzleLedgerRepository(tx)))
}

/**
 * Reads run in a transaction too. A trial balance assembled from several
 * queries against a moving ledger is a trial balance that does not add up.
 */
export async function withReporting<T>(
  database: Database,
  work: (repository: ReportingRepository) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => work(new ReportingRepository(tx)), {
    accessMode: 'read only',
    isolationLevel: 'repeatable read',
  })
}
