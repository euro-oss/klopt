import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReferenceDataFromDirectory, type ReferenceDataStore } from '@klopt/core'
import { resolveDocumentStore, resolveTimestampWitness } from '@klopt/adapters'
import {
  SealRefusedError,
  closeDatabase,
  createDatabase,
  sealFiscalYear,
  withSnapshotsRead,
  type Database,
} from '@klopt/db'
import type { DocumentStore, TimestampWitness } from '@klopt/core'

/**
 * Periodic sealed snapshots (spec 7.6).
 *
 * > "Periodic sealed snapshots: a scheduled XAF export plus a manifest of
 * > document hashes, written to the WORM bucket."
 *
 * The word doing the work is *periodic*. A snapshot somebody has to remember to
 * take is a snapshot that exists for the year somebody was paying attention,
 * and the years an inspector asks about are the other ones.
 *
 * ## Only years that need it
 *
 * A book year with postings and no snapshot gets one. A year already sealed
 * does not get resealed nightly: resealing an unchanged year every night would
 * produce three hundred and sixty-five near-identical artefacts and bury the
 * one that changed. Resealing is a deliberate act with its own button.
 *
 * That means a year sealed in March and posted into in April carries a
 * snapshot from March, which is correct: the snapshot says what was true when
 * it was taken, and `verifySnapshot` treats growth as growth rather than drift.
 *
 * ## One administration failing is one administration failing
 *
 * A year whose auditfile will not validate cannot be sealed, and that is a real
 * condition rather than an error in this job — usually a missing seller address
 * or an unmapped account. It is logged with the rule that refused it and the
 * sweep carries on, because the alternative is one broken administration
 * stopping every other one from being sealed.
 */

function referenceDataStore(): ReferenceDataStore {
  const fromEnvironment = process.env['KLOPT_REFERENCE_DATA_DIR']
  const directory =
    fromEnvironment !== undefined && fromEnvironment !== ''
      ? resolve(fromEnvironment)
      : // Repository layout: apps/worker/src -> ../../../reference-data
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'reference-data')

  return loadReferenceDataFromDirectory(directory)
}

/** The same choice the web app makes, from the same environment. */
function storeFor(): DocumentStore {
  return resolveDocumentStore(process.env)
}

export interface SnapshotSweepSummary {
  readonly sealed: readonly {
    readonly entityId: string
    readonly fiscalYear: string
    readonly seal: string
  }[]
  readonly refused: readonly {
    readonly entityId: string
    readonly fiscalYear: string
    readonly reason: string
  }[]
}

export async function sealPendingYears(
  database: Database,
  store: DocumentStore = storeFor(),
  referenceData: ReferenceDataStore = referenceDataStore(),
  // Resolved from the same environment the API reads, so a nightly seal and a
  // seal somebody pressed a button for carry the same kind of evidence.
  witness: TimestampWitness = resolveTimestampWitness(process.env),
): Promise<SnapshotSweepSummary> {
  const entities = await withSnapshotsRead(database, (repository) =>
    repository.entitiesWithPostings(),
  )

  const sealed: { entityId: string; fiscalYear: string; seal: string }[] = []
  const refused: { entityId: string; fiscalYear: string; reason: string }[] = []

  for (const entityId of entities) {
    const years = await withSnapshotsRead(database, (repository) =>
      repository.yearsNeedingSnapshot(entityId),
    )

    for (const fiscalYear of years) {
      try {
        const result = await sealFiscalYear(database, store, referenceData, witness, {
          entityId,
          fiscalYear,
          // Not a person. The audit trail distinguishes human from script, and
          // a nightly seal should not look like somebody pressed a button.
          sealedBy: 'worker:snapshot',
        })
        sealed.push({ entityId, fiscalYear, seal: result.snapshot.seal })
      } catch (error: unknown) {
        refused.push({
          entityId,
          fiscalYear,
          reason:
            error instanceof SealRefusedError
              ? `${error.message} ${error.failures.map((failure) => failure.path).join(', ')}`
              : error instanceof Error
                ? error.message
                : String(error),
        })
      }
    }
  }

  return { sealed, refused }
}

/** The job body, which owns its own connection because it runs on a schedule. */
export async function sealPendingYearsJob(databaseUrl: string): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 2 })
  try {
    const summary = await sealPendingYears(database)

    for (const entry of summary.sealed) {
      console.info(
        `[worker] snapshot: ${entry.entityId} ${entry.fiscalYear} sealed as ${entry.seal.slice(0, 16)}…`,
      )
    }
    for (const entry of summary.refused) {
      console.warn(
        `[worker] snapshot: ${entry.entityId} ${entry.fiscalYear} not sealed — ${entry.reason}`,
      )
    }
  } finally {
    await closeDatabase(database)
  }
}
