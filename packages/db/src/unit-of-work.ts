import type { Database } from './client.js'
import { DrizzleLedgerRepository } from './repositories/ledger.js'
import { ReportingRepository } from './repositories/reporting.js'
import { RgsRepository } from './repositories/rgs.js'
import { XafExportRepository } from './repositories/xaf.js'

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

/**
 * An XAF export reads a whole fiscal year across several queries. A repeatable
 * read snapshot is what stops the header totals from disagreeing with the lines
 * because somebody posted while the file was being built.
 */
export async function withXafExport<T>(
  database: Database,
  work: (repository: XafExportRepository) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => work(new XafExportRepository(tx)), {
    accessMode: 'read only',
    isolationLevel: 'repeatable read',
  })
}

/** RGS mapping changes and year-close bookkeeping. */
export async function withRgs<T>(
  database: Database,
  work: (repository: RgsRepository) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => work(new RgsRepository(tx)))
}

/**
 * A year close posts two entries and records the close, all together. Half a
 * close — a P&L flattened with no opening balance, or an opening balance nobody
 * recorded — is worse than none.
 */
export async function withYearClose<T>(
  database: Database,
  work: (repositories: {
    ledger: DrizzleLedgerRepository
    reporting: ReportingRepository
    rgs: RgsRepository
  }) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) =>
    work({
      ledger: new DrizzleLedgerRepository(tx),
      reporting: new ReportingRepository(tx),
      rgs: new RgsRepository(tx),
    }),
  )
}
