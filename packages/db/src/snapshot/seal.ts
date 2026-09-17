import {
  KLOPT_VERSION,
  generateXaf,
  resourceOf,
  sealSnapshot,
  validateXafDocument,
  versionOf,
  type DocumentStore,
  type ReferenceDataStore,
  type SealedSnapshot,
  type TimestampOutcome,
  type TimestampWitness,
} from '@klopt/core'
import type { Database } from '../client.js'
import { withInbox, withReporting, withSnapshots, withXafExport } from '../unit-of-work.js'

/**
 * Sealing a book year (spec 7.6).
 *
 * This lives below the web app for the same reason `receiveDocument` does:
 * there are two callers and they must not drift. A person presses a button; a
 * scheduled job in the worker runs the same thing overnight. If the two
 * produced different manifests, a snapshot would mean something different
 * depending on who asked for it — and a snapshot whose meaning depends on its
 * caller is not evidence.
 *
 * The worker cannot import the web framework (spec 11.1), so the shared step
 * has to sit here rather than in a handler. That is the whole argument for the
 * `core`/`db` split existing at all.
 */

export interface SealOptions {
  readonly entityId: string
  readonly fiscalYear: string
  readonly sealedBy: string
  /** Stamped by the caller so a seal is reproducible from its own text. */
  readonly sealedAt?: string | undefined
}

export interface SealResult {
  readonly id: string
  readonly snapshot: SealedSnapshot
  readonly auditFileSha256: string
  readonly manifestSha256: string
  /** What an outside authority said, or why there is nothing (ADR 0058). */
  readonly timestamp: TimestampOutcome
}

export class SealRefusedError extends Error {
  constructor(
    message: string,
    readonly failures: readonly { path: string; message: string }[],
  ) {
    super(message)
    this.name = 'SealRefusedError'
  }
}

/**
 * Export the auditfile, hash both artefacts, and write the seal.
 *
 * ## The auditfile is validated before anything is sealed
 *
 * "An invalid XAF is a build-breaking bug, not a warning" (spec 7.3), and a
 * snapshot of an auditfile that cannot be produced is not a snapshot worth
 * having — it would seal a hash over bytes nobody can use. So the export and
 * its schema check happen first, outside the sealing transaction, and a failure
 * names the rule rather than saying "sealing failed".
 *
 * ## Both artefacts become documents
 *
 * The XAF and the manifest go into the content-addressed store and get rows in
 * `documents`, which puts them under the bewaarplicht, the append-only guard
 * and the deduplication — rather than each needing its own version of all
 * three. Resealing an unchanged year stores no second copy of an identical
 * auditfile, which is deduplication earning its keep on exactly the case it was
 * designed for.
 */
export async function sealFiscalYear(
  database: Database,
  store: DocumentStore,
  referenceData: ReferenceDataStore,
  witness: TimestampWitness,
  options: SealOptions,
): Promise<SealResult> {
  const entity = await withReporting(database, (repository) => repository.entity(options.entityId))
  if (entity === null) throw new SealRefusedError('No such administration.', [])

  const key = `${entity.rgsVersion ?? '3.7'}-${entity.rgsVariant}`
  const scheme = referenceData.hasRgs(key) ? referenceData.rgs(key) : null

  const document = await withXafExport(database, (repository) =>
    repository.build(
      {
        entityId: options.entityId,
        fiscalYearCode: options.fiscalYear,
        softwareDesc: 'Klopt',
        softwareVersion: process.env['KLOPT_VERSION'] ?? KLOPT_VERSION,
        generatedOn: new Date().toISOString().slice(0, 10),
      },
      scheme,
    ),
  )

  const validation = validateXafDocument(document)
  if (!validation.valid) {
    throw new SealRefusedError(
      `The auditfile for ${options.fiscalYear} is not valid, so there is nothing worth sealing.`,
      validation.problems.map((problem) => ({ path: problem.path, message: problem.message })),
    )
  }

  const xml = generateXaf(document)
  const auditFile = await store.put(new TextEncoder().encode(xml), {
    contentType: 'application/xml',
  })

  const sealedAt = options.sealedAt ?? new Date().toISOString()

  const snapshot = await withSnapshots(database, async ({ snapshots, retention }) => {
    // The terms first, so the manifest records what each document was going to
    // be kept until rather than a null nobody can interpret in seven years.
    await retention.dateDocuments(options.entityId)

    const [chain, documents, previousSeal] = await Promise.all([
      snapshots.chainState(options.entityId),
      snapshots.documentsFor(options.entityId),
      snapshots.latestSeal(options.entityId),
    ])

    return sealSnapshot({
      entityId: options.entityId,
      fiscalYear: options.fiscalYear,
      sealedAt,
      chainHead: chain.head,
      entryCount: chain.entryCount,
      auditFileSha256: auditFile.sha256,
      auditFileLineCount: validation.lineCount,
      documents,
      previousSeal,
    })
  })

  const manifest = await store.put(new TextEncoder().encode(snapshot.manifest), {
    contentType: 'text/plain; charset=utf-8',
  })

  /**
   * Ask somebody outside to say they saw it (ADR 0058).
   *
   * After the seal exists and before it is recorded, because the seal is what
   * is stamped — and it cannot fail the sealing: an unreachable authority
   * records a reason and the snapshot is written anyway. A scheduled job that
   * stopped producing evidence because of somebody else's downtime would be
   * worse than one that occasionally produces evidence with no witness.
   */
  const timestamp = await witness.stamp(snapshot.seal)

  const id = await withSnapshots(database, async ({ snapshots }) => {
    const recorded = await snapshots.record({
      entityId: options.entityId,
      sealedBy: options.sealedBy,
      snapshot,
      manifestSha256: manifest.sha256,
      timestamp,
    })

    // In the transaction that recorded it (ADR 0051). An archival system wants
    // the hash the moment it exists rather than whenever it next looks, and a
    // seal is the one artefact where "whenever it next looks" is too late to
    // prove anything about when.
    await snapshots.enqueueEvent({
      entityId: options.entityId,
      type: 'compliance.snapshot.sealed',
      version: versionOf('compliance.snapshot.sealed'),
      payload: { resourceType: resourceOf('compliance.snapshot.sealed'), resourceId: recorded },
    })

    return recorded
  })

  await withInbox(database, async ({ inbox }) => {
    for (const artefact of [
      {
        stored: auditFile,
        contentType: 'application/xml',
        filename: `${options.fiscalYear}.xaf.xml`,
        role: 'auditfile',
      },
      {
        stored: manifest,
        contentType: 'text/plain; charset=utf-8',
        filename: `${options.fiscalYear}.manifest.txt`,
        role: 'manifest',
      },
    ]) {
      const recorded = await inbox.recordDocument({
        entityId: options.entityId,
        sha256: artefact.stored.sha256,
        sizeBytes: artefact.stored.sizeBytes,
        contentType: artefact.contentType,
        filename: artefact.filename,
      })

      await inbox.link({
        entityId: options.entityId,
        documentId: recorded.id,
        subjectKind: 'sealed_snapshot',
        subjectId: id,
        role: artefact.role,
      })
    }
  })

  return {
    id,
    snapshot,
    auditFileSha256: auditFile.sha256,
    manifestSha256: manifest.sha256,
    timestamp,
  }
}
