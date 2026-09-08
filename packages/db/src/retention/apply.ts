import { supportsWorm, type DocumentStore } from '@klopt/core'
import type { Database } from '../client.js'
import { withRetention } from '../unit-of-work.js'

/**
 * Derive retention terms and tell the storage about them (spec 7.6).
 *
 * Two halves that belong together and were briefly apart. Deriving the term is
 * a database question — which book year is this document evidence for — and
 * *enforcing* it is a storage one. A term written to a column and never pushed
 * at the store would be the application promising something the storage had
 * never been asked to keep.
 *
 * ## Why this happens after the fact rather than at PUT
 *
 * Object lock is set per object and can be extended but never shortened, and at
 * the moment bytes arrive their term is unknown — it is counted from the book
 * year of whatever the document turns out to be evidence for (ADR 0030). A
 * receipt uploaded today may belong to 2018. Guessing at PUT time would lock it
 * until 2033 with, in compliance mode, no way back.
 *
 * So: store unlocked, derive the term when the document is linked to something,
 * then lock. The window between is real and the retention screen counts it,
 * because "protected by the application but not yet by the storage" is a
 * different state from either end of it.
 *
 * ## A store that cannot lock is not an error
 *
 * The filesystem store has no object lock and says so. This is a no-op there
 * rather than a failure, and the screen reports `objectLock: false` — a
 * compliance surface that implied a guarantee the storage does not make would
 * be worse than one that admits the limit.
 *
 * ## A failure to lock does not fail the caller
 *
 * The callers are a preview and a deletion. Neither should break because the
 * object store was briefly unreachable, and neither is made *unsafe* by a
 * missing lock: the application's own policy still refuses. So a refusal is
 * counted and returned rather than thrown, and the count is what a screen shows.
 */

export interface RetentionApplication {
  /** Documents whose term was derived and written to the database. */
  readonly dated: number
  /** Of those, how many the storage is now holding. */
  readonly locked: number
  /** Terms the storage would not take, with the reason. */
  readonly refused: readonly { readonly sha256: string; readonly reason: string }[]
  /** False for a store with no object lock, which is not a failure. */
  readonly storageEnforced: boolean
}

export async function applyRetention(
  database: Database,
  store: DocumentStore,
  entityId: string,
): Promise<RetentionApplication> {
  const dated = await withRetention(database, (repository) => repository.dateDocuments(entityId))

  if (!supportsWorm(store)) {
    return { dated: dated.length, locked: 0, refused: [], storageEnforced: false }
  }

  let locked = 0
  const refused: { sha256: string; reason: string }[] = []

  for (const document of dated) {
    try {
      // Idempotent and monotonic: the store extends a term and refuses to
      // shorten one, so re-applying an unchanged term costs a call and changes
      // nothing.
      await store.retain(document.sha256, document.retainUntil)
      locked += 1
    } catch (error: unknown) {
      refused.push({
        sha256: document.sha256,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { dated: dated.length, locked, refused, storageEnforced: true }
}
