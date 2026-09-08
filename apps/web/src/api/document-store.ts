import { resolveDocumentStore } from '@klopt/adapters'
import type { DocumentStore } from '@klopt/core'

/**
 * Where source documents live.
 *
 * A directory by default, because spec 8's first rule says the implementation
 * that needs no third party is the default in a fresh install — and nobody
 * should have to run object storage to keep books. Setting `KLOPT_S3_ENDPOINT`
 * and its credentials switches to S3-compatible storage with object lock, which
 * is what turns the retention promise from the application's into the storage's
 * (spec 7.6).
 *
 * The choice itself lives in `@klopt/adapters` because the worker makes it too,
 * and two processes disagreeing about where documents live is a class of bug
 * worth making impossible.
 */

let store: DocumentStore | null = null

export function documentStore(): DocumentStore {
  store ??= resolveDocumentStore(process.env)
  return store
}

/** Test seam. */
export function setDocumentStoreForTest(value: DocumentStore | null): void {
  store = value
}
