import { createFilesystemDocumentStore } from '@klopt/adapters'
import type { DocumentStore } from '@klopt/core'
import { join } from 'node:path'

/**
 * Where source documents live.
 *
 * A directory by default, because spec 8's first rule says the implementation
 * that needs no third party is the default in a fresh install — and nobody
 * should have to run object storage to keep books. `KLOPT_DOCUMENT_DIR` moves
 * it; an S3-compatible adapter is somebody's later choice, not a prerequisite.
 */

let store: DocumentStore | null = null

export function documentStore(): DocumentStore {
  store ??= createFilesystemDocumentStore({
    directory: process.env['KLOPT_DOCUMENT_DIR'] ?? join(process.cwd(), '.klopt', 'documents'),
  })
  return store
}

/** Test seam. */
export function setDocumentStoreForTest(value: DocumentStore | null): void {
  store = value
}
