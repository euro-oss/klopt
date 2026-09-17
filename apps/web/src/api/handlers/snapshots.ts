import {
  PERMISSIONS,
  readTimeStampResponse,
  verifyHashChain,
  verifySnapshot,
  type SealedSnapshot,
} from '@klopt/core'
import {
  SealRefusedError,
  sealFiscalYear,
  withLedger,
  withSnapshots,
  withSnapshotsRead,
  type SnapshotRow,
} from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { documentStore } from '../document-store.js'
import { timestampWitness } from '../timestamp.js'
import { referenceData } from '../reference-data.js'
import { handleExportAuditFile } from './compliance.js'
import type { SealSnapshotBody } from '../schemas.js'

/**
 * Sealed snapshots (spec 7.6): the "prove nothing changed" artefact.
 *
 * ## Why the seal is worth more than the copy
 *
 * A snapshot that is only a copy proves little: two copies that differ say
 * something changed and not which one is right. What makes this evidential is
 * that it is small and self-verifying — the ledger's chain head, a list of
 * document hashes, the auditfile's hash, and one hash over all of it.
 *
 * That last number is a few dozen characters. It can be written down, emailed
 * to an accountant, read out over the phone, or put somewhere nobody can
 * change — and any of those is enough to detect a change in seven years of
 * books.
 *
 * ## Both artefacts go into the document store
 *
 * The auditfile and the manifest are stored like any other document, which
 * means they inherit content addressing, deduplication, retention and the
 * append-only guard rather than needing their own of each. Resealing an
 * unchanged year stores no second copy of an identical auditfile, which is the
 * deduplication earning its keep on the exact case it was designed for.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function serialise(row: SnapshotRow) {
  return {
    id: row.id,
    fiscalYear: row.fiscalYear,
    sealedAt: row.sealedAt,
    sealedBy: row.sealedBy,
    seal: row.seal,
    previousSeal: row.previousSeal,
    chainHead: row.chainHead,
    entryCount: row.entryCount,
    auditFileSha256: row.auditFileSha256,
    auditFileLineCount: row.auditFileLineCount,
    manifestSha256: row.manifestSha256,
    documentCount: row.documentCount,
    deletedDocumentCount: row.deletedDocumentCount,
    totalBytes: row.totalBytes.toString(),
    /**
     * The token is not here. It is a couple of kilobytes of base64 per row,
     * and a list of snapshots is not where somebody reaches for evidence —
     * `GET /snapshots/{id}/timestamp` hands over the file `openssl ts -verify`
     * takes.
     */
    timestamp: {
      witnessed: row.timestampToken !== null,
      authority: row.timestampAuthority,
      at: row.timestampAt,
      serialNumber: row.timestampSerial,
      reason: row.timestampReason,
    },
    verifiedAt: row.verifiedAt,
    verifiedOk: row.verifiedOk,
    drift: row.drift as
      | readonly { code: string; detail: string; expected: string | null; actual: string | null }[]
      | null,
  }
}

/** The stored snapshot back in the shape the domain verifies. */
function toSealed(row: SnapshotRow, documents: SealedSnapshot['documents']): SealedSnapshot {
  return {
    entityId: '',
    fiscalYear: row.fiscalYear,
    sealedAt: row.sealedAt,
    chainHead: row.chainHead,
    entryCount: row.entryCount,
    auditFileSha256: row.auditFileSha256,
    auditFileLineCount: row.auditFileLineCount,
    documents,
    previousSeal: row.previousSeal,
    manifest: row.manifest,
    seal: row.seal,
    documentCount: row.documentCount,
    deletedDocumentCount: row.deletedDocumentCount,
    totalBytes: row.totalBytes,
  }
}

/**
 * The documents a stored manifest names, read back out of its own text.
 *
 * Parsed from the manifest rather than re-queried, and that is the point: the
 * manifest is the record of what was sealed, and asking the database what it
 * holds *now* would be comparing the present against itself.
 */
function documentsFromManifest(manifest: string): SealedSnapshot['documents'] {
  return manifest
    .split('\n')
    .filter((line) => line.startsWith('document='))
    .map((line) => {
      const [sha256, size, retainUntil, state] = line.slice('document='.length).split(' ')
      return {
        sha256: sha256 ?? '',
        sizeBytes: Number(size ?? '0'),
        // `-` is the manifest's placeholder for an absent value. See `ABSENT`
        // in packages/core/src/snapshot/manifest.ts.
        retainUntil: retainUntil === '-' || retainUntil === undefined ? null : retainUntil,
        deleted: state === 'deleted',
      }
    })
}

/**
 * Seal a book year.
 *
 * The work is in `@klopt/db`, because the worker runs the same thing on a
 * schedule and cannot import a handler. Two callers producing different
 * manifests would make a snapshot mean something different depending on who
 * asked for it, and a snapshot whose meaning depends on its caller is not
 * evidence.
 */
export async function handleSealSnapshot(context: RequestContext, body: SealSnapshotBody) {
  requirePermission(context, PERMISSIONS.export)

  let result
  try {
    result = await sealFiscalYear(
      context.database,
      documentStore(),
      referenceData(),
      timestampWitness(),
      {
        entityId: context.entityId,
        fiscalYear: body.fiscalYear,
        sealedBy: context.actor.id,
      },
    )
  } catch (error: unknown) {
    // The auditfile refusing to validate is not "sealing failed": it names the
    // rule, and the rule is what somebody has to fix. Spec 7.3.
    if (error instanceof SealRefusedError) {
      throw new ApiError(
        'validation_failed',
        error.message,
        error.failures.map((failure) => ({
          code: 'invalid_auditfile',
          path: failure.path,
          message: failure.message,
        })),
      )
    }
    throw error
  }

  const { snapshot } = result

  await recordAudit(context, {
    action: 'snapshot.seal',
    resourceType: 'sealed_snapshot',
    resourceId: result.id,
    after: {
      fiscalYear: body.fiscalYear,
      // The seal is the whole point of the row. Recorded here as well so it
      // survives in the audit log's own export, which is a separate artefact —
      // two independent places to find the same number.
      seal: snapshot.seal,
      previousSeal: snapshot.previousSeal,
      chainHead: snapshot.chainHead,
      entryCount: snapshot.entryCount,
      documentCount: snapshot.documentCount,
      auditFileSha256: result.auditFileSha256,
      manifestSha256: result.manifestSha256,
    },
  })

  return {
    status: 201,
    body: {
      id: result.id,
      fiscalYear: body.fiscalYear,
      sealedAt: snapshot.sealedAt,
      seal: snapshot.seal,
      previousSeal: snapshot.previousSeal,
      chainHead: snapshot.chainHead,
      entryCount: snapshot.entryCount,
      documentCount: snapshot.documentCount,
      deletedDocumentCount: snapshot.deletedDocumentCount,
      totalBytes: snapshot.totalBytes.toString(),
      auditFileSha256: result.auditFileSha256,
      manifestSha256: result.manifestSha256,
      /**
       * Whether anybody outside has seen this seal (ADR 0058).
       *
       * On the creation response as well as on the row, because the moment a
       * seal is taken is the moment somebody decides whether to write the
       * date down themselves — and "no witness, and here is why" is the
       * answer that makes them do it.
       */
      timestamp:
        result.timestamp.kind === 'stamped'
          ? {
              witnessed: true as const,
              authority: result.timestamp.authority,
              at: result.timestamp.token.genTime,
              serialNumber: result.timestamp.token.serialNumber,
              reason: null,
            }
          : {
              witnessed: false as const,
              authority: null,
              at: null,
              serialNumber: null,
              reason: result.timestamp.reason,
            },
    },
  }
}

export async function handleListSnapshots(context: RequestContext) {
  requirePermission(context, PERMISSIONS.read)

  return withSnapshotsRead(context.database, async (repository) => {
    const rows = await repository.list(context.entityId)
    return { status: 200, body: { snapshots: rows.map(serialise) } }
  })
}

/** The manifest text, which is what a seal is checked against. */
export async function handleGetSnapshotManifest(context: RequestContext, snapshotId: string) {
  requirePermission(context, PERMISSIONS.export)

  const row = await withSnapshotsRead(context.database, (repository) =>
    repository.find(context.entityId, snapshotId),
  )
  if (row === null) throw new ApiError('not_found', 'No such snapshot.')

  return {
    manifest: row.manifest,
    filename: `snapshot-${row.fiscalYear}-${row.seal.slice(0, 12)}.manifest.txt`,
  }
}

/**
 * What the stored timestamp reply says, checked against the row it is on.
 *
 * `ok` is null when there is no witness: neither true nor false is honest
 * about a check that did not happen, and a boolean here would make a
 * snapshot with no timestamp look either verified or broken.
 */
function checkTimestamp(row: SnapshotRow): {
  readonly witnessed: boolean
  readonly ok: boolean | null
  readonly authority: string | null
  readonly at: string | null
  readonly reason: string | null
} {
  if (row.timestampToken === null) {
    return {
      witnessed: false,
      ok: null,
      authority: null,
      at: null,
      reason: row.timestampReason,
    }
  }

  try {
    const reply = readTimeStampResponse(
      new Uint8Array(Buffer.from(row.timestampToken, 'base64')),
      // No nonce: it is only meaningful at the moment of asking, and one read
      // back out of the same row would be checked against itself.
      { sha256: row.seal },
    )
    // `readTimeStampResponse` refuses a reply whose imprint is not the hash it
    // was asked about, so reaching here at all is the check passing. Comparing
    // again would read as a second check and be none.
    return {
      witnessed: true,
      ok: reply.token !== null,
      authority: row.timestampAuthority,
      at: reply.token?.genTime ?? null,
      reason: null,
    }
  } catch (error: unknown) {
    return {
      witnessed: true,
      ok: false,
      authority: row.timestampAuthority,
      at: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * The timestamp reply, as the authority sent it (ADR 0058).
 *
 * The file rather than a description of it: `openssl ts -verify -in
 * reply.tsr -data seal.txt -CAfile chain.pem` is what an auditor runs, and
 * they can only run it against bytes. Publishing the seal outside this
 * instance is the point of the whole feature, and this is the download that
 * does it.
 */
export async function handleGetSnapshotTimestamp(context: RequestContext, snapshotId: string) {
  requirePermission(context, PERMISSIONS.export)

  const row = await withSnapshotsRead(context.database, (repository) =>
    repository.find(context.entityId, snapshotId),
  )
  if (row === null) throw new ApiError('not_found', 'No such snapshot.')
  if (row.timestampToken === null) {
    throw new ApiError(
      'not_found',
      row.timestampReason ??
        'No timestamp authority saw this seal, so there is no reply to hand over.',
    )
  }

  return {
    token: Buffer.from(row.timestampToken, 'base64'),
    filename: `snapshot-${row.fiscalYear}-${row.seal.slice(0, 12)}.tsr`,
  }
}

/**
 * Check a snapshot against the administration as it is now.
 *
 * ## Two checks, and only one of them needs the exporter
 *
 * The cheap check compares the chain head, the entry count and the document
 * hashes. It is fast and somebody should be able to run it whenever they like.
 *
 * The full check re-exports the auditfile and compares its bytes, which is slow
 * and is the one that will fire benignly when the exporter improves. So it is
 * opt-in — and when it is off, the auditfile hash is reported as *not looked
 * at* rather than as unchanged. A verification that quietly skipped a check and
 * said "verified" would be the worst outcome available.
 */
export async function handleVerifySnapshot(
  context: RequestContext,
  snapshotId: string,
  options: { readonly recomputeAuditFile: boolean },
) {
  requirePermission(context, PERMISSIONS.export)

  const row = await withSnapshotsRead(context.database, (repository) =>
    repository.find(context.entityId, snapshotId),
  )
  if (row === null) throw new ApiError('not_found', 'No such snapshot.')

  let auditFileSha256: string | null = null
  if (options.recomputeAuditFile) {
    const exported = await handleExportAuditFile(context, {
      fiscalYear: row.fiscalYear,
      fromPeriod: null,
      toPeriod: null,
    })
    const { sha256 } = await documentStore().put(new TextEncoder().encode(exported.xml), {
      contentType: 'application/xml',
    })
    auditFileSha256 = sha256
  }

  /**
   * Whether the chain still verifies against its own contents.
   *
   * Not the same question as "has the head moved". The head is the last
   * entry's *stored* hash, so somebody who rewrites a description and leaves
   * the hash column alone changes the books and moves no head at all — this is
   * the check that notices, and it recomputes every entry's hash from its
   * canonical content to do it.
   *
   * It reads the whole chain, so it is the expensive half of a verification.
   * Done anyway: a check that skipped the only thing catching content tampering
   * would be a check worth nothing.
   */
  const chain = await withLedger(context.database, (repository) =>
    repository.loadChain(context.entityId),
  )
  const chainCheck = verifyHashChain(chain)

  const result = await withSnapshots(context.database, async ({ snapshots, retention }) => {
    await retention.dateDocuments(context.entityId)

    const [state, documents] = await Promise.all([
      snapshots.chainState(context.entityId),
      snapshots.documentsFor(context.entityId),
    ])

    const verification = verifySnapshot(toSealed(row, documentsFromManifest(row.manifest)), {
      chainHead: state.head,
      entryCount: state.entryCount,
      chainVerified: chainCheck.verified,
      chainFailures: chainCheck.failures.map(
        (failure) => `${failure.reason} at ${failure.chainSequence.toString()}`,
      ),
      auditFileSha256,
      documents,
    })

    await snapshots.recordVerification({
      entityId: context.entityId,
      snapshotId,
      ok: verification.verified,
      drift: verification.drift,
    })

    return verification
  })

  /**
   * Does the witness still attest to *this* seal?
   *
   * Cheap, and it catches the one failure the rest of the verification cannot
   * see: a row whose seal was edited while its token was left alone, which
   * would otherwise present somebody else's timestamp as evidence for a
   * number it never covered. Read out of the stored reply rather than from
   * the columns beside it, because the columns are what would have been
   * edited too.
   */
  const timestamp = checkTimestamp(row)

  await recordAudit(context, {
    action: 'snapshot.verify',
    resourceType: 'sealed_snapshot',
    resourceId: snapshotId,
    after: {
      verified: result.verified,
      auditFileChecked: options.recomputeAuditFile,
      chainVerified: chainCheck.verified,
      timestampVerified: timestamp.ok,
      drift: result.drift.map((entry) => entry.code),
    },
  })

  return {
    status: 200,
    body: {
      id: snapshotId,
      seal: row.seal,
      verified: result.verified,
      // Said explicitly, because "verified" with a check skipped is a lie by
      // omission.
      auditFileChecked: options.recomputeAuditFile,
      chainVerified: chainCheck.verified,
      timestamp,
      drift: result.drift,
    },
  }
}
