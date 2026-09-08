import {
  PERMISSIONS,
  RETENTION_CLASS_LABEL,
  retentionState,
  summariseRetention,
  supportsWorm,
} from '@klopt/core'
import {
  applyRetention,
  withRetention,
  withRetentionRead,
  type RetentionDocumentRow,
} from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { documentStore } from '../document-store.js'
import type {
  DeleteDocumentsBody,
  RetentionQuery,
  SetLegalHoldBody,
  SetRetentionClassBody,
} from '../schemas.js'

/**
 * The bewaarplicht, as a screen and two buttons (spec 7.6).
 *
 * Three things the spec is explicit about, and they shape everything here:
 *
 *   - "Object storage with object lock or WORM mode, with a retention date
 *     computed per document from its fiscal year." The date is computed and
 *     stored; the object lock is a property of the store and the default store
 *     does not have one, which `GET` says out loud rather than implying.
 *   - "Legal hold: a flag that suspends deletion regardless of retention date."
 *   - "Deletion after retention is a deliberate, audited, permissioned batch
 *     action with a preview. **Never automatic.**"
 *
 * That last sentence is why there is no scheduled job in this file and no
 * lifecycle rule anywhere. A retention date arriving in the past is not an
 * instruction; it is a fact somebody may act on.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function serialise(row: RetentionDocumentRow, asOf: string, entityLegalHold: boolean) {
  const state = retentionState(row, { asOf, entityLegalHold })
  return {
    id: row.id,
    sha256: row.sha256,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    firstSeenAt: row.firstSeenAt,
    retentionClass: row.retentionClass,
    retentionClassLabel: RETENTION_CLASS_LABEL[row.retentionClass],
    retainUntil: row.retainUntil,
    retentionFiscalYear: row.retentionFiscalYear,
    legalHold: row.legalHold,
    legalHoldReason: row.legalHoldReason,
    deletedAt: row.deletedAt,
    deletedReason: row.deletedReason,
    linkCount: row.linkCount,
    state: state.code,
    deletable: state.deletable,
    reason: state.reason,
  }
}

/**
 * The preview.
 *
 * Every state, not only the deletable ones — an operator wondering why nothing
 * can be deleted needs an answer, and "0 documents" is not one. The retention
 * dates are re-derived first, because a document linked to a posting since the
 * last look has a book year now and its term should not wait for a job.
 */
export async function handleGetRetention(context: RequestContext, query: RetentionQuery) {
  requirePermission(context, PERMISSIONS.export)

  const asOf = query.asOf ?? today()

  // A read that writes, and the one place it is right to: deriving a term from
  // links that already exist changes no decision, and a preview computed from a
  // stale term would be a preview of the wrong thing. It also pushes the terms
  // at the storage, because a term in a column that the store was never told
  // about is the application promising something nobody is keeping.
  const applied = await applyRetention(context.database, documentStore(), context.entityId)

  return withRetentionRead(context.database, async (repository) => {
    const [hold, rows] = await Promise.all([
      repository.entityHold(context.entityId),
      repository.list(context.entityId),
    ])

    const summary = summariseRetention(rows, { asOf, entityLegalHold: hold.held })
    const store = documentStore()

    // Asked, not assumed. "This is an S3 store" and "this bucket holds bytes
    // down" are different claims, and only one of them is worth printing on a
    // compliance screen.
    const lock = supportsWorm(store) ? await store.verifyLock() : { enabled: false, reason: null }

    return {
      status: 200,
      body: {
        asOf,
        legalHold: hold,
        summary: {
          documents: summary.documents,
          byState: summary.byState,
          deletableBytes: summary.deletableBytes.toString(),
        },
        /**
         * What the storage itself guarantees, said plainly.
         *
         * Spec 7.6 asks for object lock or WORM mode. A directory has neither,
         * so the retention promise there is the application's rather than the
         * storage's — and claiming otherwise on a compliance screen would be
         * the worst kind of wrong. `locked` versus `dated` is the honest middle
         * state: a document whose term is known but which the store has not
         * been told about yet.
         */
        storage: {
          name: store.name,
          objectLock: lock.enabled,
          mode: lock.enabled && supportsWorm(store) ? store.worm.mode : null,
          dated: applied.dated,
          locked: applied.locked,
          refused: applied.refused.length,
          note: !lock.enabled
            ? (lock.reason ??
              'Deze opslag heeft geen object lock: de bewaartermijn wordt door de applicatie afgedwongen, niet door de opslag. Een bucket met object lock maakt er een echte garantie van.')
            : applied.refused.length > 0
              ? `${String(applied.refused.length)} document(en) kon de opslag niet vasthouden. De applicatie weigert verwijderen nog steeds, maar de opslag garandeert het niet.`
              : null,
        },
        documents: rows.map((row) => serialise(row, asOf, hold.held)),
      },
    }
  })
}

/** A hold over the whole administration, or over named documents. */
export async function handleSetLegalHold(context: RequestContext, body: SetLegalHoldBody) {
  requirePermission(context, PERMISSIONS.manageRetention)

  if (body.held && (body.reason ?? '').trim() === '') {
    throw new ApiError(
      'validation_failed',
      'A legal hold needs a reason. It outlives the bewaarplicht, so the next person has to know why it is there.',
      [{ code: 'missing_reason', path: 'reason', message: 'Say why this is being held.' }],
    )
  }

  return withRetention(context.database, async (repository) => {
    if (body.scope === 'entity') {
      const before = await repository.entityHold(context.entityId)
      await repository.setEntityHold(context.entityId, body.held, body.reason)

      await recordAudit(context, {
        action: body.held ? 'retention.holdEntity' : 'retention.releaseEntity',
        resourceType: 'entity',
        resourceId: context.entityId,
        before: { legalHold: before.held, reason: before.reason },
        after: { legalHold: body.held, reason: body.reason },
      })

      return { status: 200, body: { scope: 'entity', held: body.held, documents: 0 } }
    }

    const affected = await repository.setDocumentHold({
      entityId: context.entityId,
      documentIds: body.documentIds,
      held: body.held,
      reason: body.reason,
    })

    await recordAudit(context, {
      action: body.held ? 'retention.holdDocuments' : 'retention.releaseDocuments',
      resourceType: 'document',
      // A batch is one act. The ids are in `after` rather than being one row
      // each, because "these forty were held for this reason" is the fact.
      resourceId: `${String(affected)} document(s)`,
      after: { documentIds: body.documentIds, held: body.held, reason: body.reason },
    })

    return { status: 200, body: { scope: 'documents', held: body.held, documents: affected } }
  })
}

/** Ten years rather than seven, for a document about immovable property. */
export async function handleSetRetentionClass(
  context: RequestContext,
  body: SetRetentionClassBody,
) {
  requirePermission(context, PERMISSIONS.manageRetention)

  return withRetention(context.database, async (repository) => {
    /**
     * A term may be extended and not shortened.
     *
     * This mirrors object lock exactly, and that is the reason for it. Going
     * from ten years back to seven would drop the database's term below the
     * one the storage is holding, and the store — correctly — would refuse the
     * deletion the application had started offering. The two would disagree
     * about a statutory obligation, which is the one thing this pair must never
     * do.
     *
     * The disagreement is unreachable any other way: a term derived from a book
     * year only ever grows, because a document linked to several subjects takes
     * the latest year. Reclassifying downwards was the only path to it, and it
     * bought nothing — under a compliance lock the storage would not have
     * honoured it anyway.
     */
    if (body.retentionClass === 'standard') {
      const rows = await repository.list(context.entityId)
      const wanted = new Set(body.documentIds)
      const longer = rows.filter(
        (row) => wanted.has(row.id) && row.retentionClass === 'immovable_property',
      )

      if (longer.length > 0) {
        throw new ApiError(
          'validation_failed',
          `${String(longer.length)} of these are kept for ten years as onroerend goed, and a retention term cannot be shortened. Storage under an object lock would refuse it too, leaving the books and the bytes disagreeing about the law.`,
          longer.map((row) => ({
            code: 'term_cannot_shorten',
            path: `documents.${row.id}`,
            message: `${row.filename ?? row.sha256} is kept until ${row.retainUntil ?? 'a date not yet known'}.`,
          })),
        )
      }
    }

    const affected = await repository.setRetentionClass({
      entityId: context.entityId,
      documentIds: body.documentIds,
      retentionClass: body.retentionClass,
    })

    await recordAudit(context, {
      action: 'retention.setClass',
      resourceType: 'document',
      resourceId: `${String(affected)} document(s)`,
      after: { documentIds: body.documentIds, retentionClass: body.retentionClass },
    })

    return { status: 200, body: { documents: affected, retentionClass: body.retentionClass } }
  })
}

/**
 * Delete documents whose bewaarplicht has run out.
 *
 * ## The order, which is the whole design
 *
 *   1. **Re-check every id against the policy, here, now.** The caller sends
 *      ids it got from a preview, and a preview is a moment in the past. A hold
 *      set in between has to win, so the ids are a *request* and the policy is
 *      the authority. Anything not deletable is refused by name.
 *   2. **Mark the rows deleted and commit.** The row stays, with its hash: an
 *      inspector asking what used to be here gets an answer, and the deletion
 *      itself stays auditable.
 *   3. **Then remove the bytes.** After the commit, and only for hashes no
 *      other administration still holds — documents are content-addressed, so
 *      one firm's expired copy must not take another firm's records with it.
 *
 * Step 3 after step 2 means a crash in between leaves a row saying deleted and
 * bytes still on disk. That is the right way round: the alternative loses bytes
 * that nothing records losing, and a stray file is recoverable by running the
 * same deletion again.
 */
export async function handleDeleteDocuments(context: RequestContext, body: DeleteDocumentsBody) {
  requirePermission(context, PERMISSIONS.manageRetention)

  const asOf = today()

  const outcome = await withRetention(context.database, async (repository) => {
    // Derive the terms first, exactly as the preview does. `dateDocuments` is
    // idempotent and only reads links that already exist, and the policy has to
    // be evaluated against current facts — a document linked to a posting since
    // the last preview has a book year now, and deciding from a null term would
    // refuse it for the wrong reason.
    await repository.dateDocuments(context.entityId)

    const hold = await repository.entityHold(context.entityId)
    const rows = await repository.list(context.entityId)
    const wanted = new Set(body.documentIds)

    const found = rows.filter((row) => wanted.has(row.id))
    const missing = [...wanted].filter((id) => !found.some((row) => row.id === id))
    if (missing.length > 0) {
      throw new ApiError('not_found', `No document ${missing[0]!} in this administration.`)
    }

    // The policy decides, not the caller. A preview is a moment in the past and
    // a hold set since then has to win.
    const refused = found
      .map((row) => ({ row, state: retentionState(row, { asOf, entityLegalHold: hold.held }) }))
      .filter((entry) => !entry.state.deletable)

    if (refused.length > 0) {
      throw new ApiError(
        'validation_failed',
        `${String(refused.length)} of these may not be deleted.`,
        refused.map((entry) => ({
          code: entry.state.code,
          path: `documents.${entry.row.id}`,
          message: entry.state.reason,
        })),
      )
    }

    const deleted = await repository.markDeleted({
      entityId: context.entityId,
      documentIds: body.documentIds,
      actorId: context.actor.id,
      reason: body.reason,
    })

    // Which of these hashes anybody still keeps. Checked inside the same
    // transaction as the marking, so the answer cannot go stale between them.
    const stillHeld = await repository.hashesStillHeld(deleted.map((row) => row.sha256))

    return { deleted, stillHeld }
  })

  // After the commit. A crash here leaves a row saying deleted and bytes on
  // disk, which the same run cleans up next time; the other order loses bytes
  // nothing records losing.
  const store = documentStore()
  let bytesRemoved = 0
  let keptForOthers = 0
  const refusedByStorage: { sha256: string; until: string | null }[] = []

  for (const row of outcome.deleted) {
    if (outcome.stillHeld.has(row.sha256)) {
      keptForOthers += 1
      continue
    }

    const removal = await store.delete(row.sha256)

    /**
     * A store that refuses is the store working, not failing.
     *
     * This is the case a WORM bucket exists for, and it is reported rather than
     * counted as a success: telling a compliance screen that statutory records
     * were destroyed while they are still sitting there under their lock would
     * be the worst answer available. It happens when the application's term and
     * the storage's disagree — usually a document whose book year was learnt
     * later than its lock was set.
     */
    if (removal.outcome === 'locked') {
      refusedByStorage.push({ sha256: row.sha256, until: removal.until })
      continue
    }
    if (removal.outcome === 'deleted') bytesRemoved += 1
  }

  await recordAudit(context, {
    action: 'retention.deleteDocuments',
    resourceType: 'document',
    resourceId: `${String(outcome.deleted.length)} document(s)`,
    after: {
      reason: body.reason,
      documents: outcome.deleted.length,
      bytesRemoved,
      // Rows marked deleted whose bytes another administration still keeps.
      // Content addressing means the file outlives our copy of it.
      keptForOthers,
      // And the ones the storage itself would not let go. Recorded, because
      // "we deleted the row and the bytes are still there" is exactly the fact
      // somebody will need later.
      refusedByStorage,
      hashes: outcome.deleted.map((row) => row.sha256),
    },
  })

  return {
    status: 200,
    body: {
      deleted: outcome.deleted.length,
      bytesRemoved,
      keptForOthers,
      refusedByStorage,
      reason: body.reason,
    },
  }
}
