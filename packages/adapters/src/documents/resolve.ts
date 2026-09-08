import { join } from 'node:path'
import type { DocumentStore } from '@klopt/core'
import { createFilesystemDocumentStore } from './filesystem.js'
import { createS3DocumentStore } from './s3.js'

/**
 * Which document store an instance runs (spec 8, rule 1).
 *
 * > "Every adapter family has an implementation that needs no third party, and
 * > it is the default in a fresh install."
 *
 * So a directory unless an S3 endpoint is configured. Nobody should have to run
 * object storage to keep books, and a self-hoster with a volume mount has
 * document storage.
 *
 * The choice is here rather than in the web app because the worker makes it
 * too — the snapshot job and the mailbox poller both write documents — and two
 * processes disagreeing about where documents live is a class of bug worth
 * making impossible.
 *
 * ## All four S3 settings or none
 *
 * A half-configured store is refused rather than silently falling back to a
 * directory. Falling back would put statutory records somewhere nobody meant,
 * and the failure would surface as a missing document years later. An endpoint
 * with no credentials is a mistake somebody should hear about at boot.
 */

export interface DocumentStoreEnvironment {
  readonly KLOPT_DOCUMENT_DIR?: string | undefined
  readonly KLOPT_S3_ENDPOINT?: string | undefined
  readonly KLOPT_S3_DOCUMENTS_BUCKET?: string | undefined
  readonly KLOPT_S3_ACCESS_KEY_ID?: string | undefined
  readonly KLOPT_S3_SECRET_ACCESS_KEY?: string | undefined
  readonly KLOPT_S3_REGION?: string | undefined
  readonly KLOPT_S3_OBJECT_LOCK_MODE?: string | undefined
}

export class DocumentStoreConfigError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `KLOPT_S3_ENDPOINT is set, so object storage is wanted, but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Refusing to fall back to a directory: statutory records would go somewhere nobody meant.`,
    )
    this.name = 'DocumentStoreConfigError'
  }
}

const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== ''

export function resolveDocumentStore(
  environment: DocumentStoreEnvironment,
  cwd = process.cwd(),
): DocumentStore {
  if (!present(environment.KLOPT_S3_ENDPOINT)) {
    return createFilesystemDocumentStore({
      directory: present(environment.KLOPT_DOCUMENT_DIR)
        ? environment.KLOPT_DOCUMENT_DIR!
        : join(cwd, '.klopt', 'documents'),
    })
  }

  const missing = (
    [
      ['KLOPT_S3_DOCUMENTS_BUCKET', environment.KLOPT_S3_DOCUMENTS_BUCKET],
      ['KLOPT_S3_ACCESS_KEY_ID', environment.KLOPT_S3_ACCESS_KEY_ID],
      ['KLOPT_S3_SECRET_ACCESS_KEY', environment.KLOPT_S3_SECRET_ACCESS_KEY],
    ] as const
  )
    .filter(([, value]) => !present(value))
    .map(([name]) => name)

  if (missing.length > 0) throw new DocumentStoreConfigError(missing)

  return createS3DocumentStore({
    endpoint: environment.KLOPT_S3_ENDPOINT!,
    bucket: environment.KLOPT_S3_DOCUMENTS_BUCKET!,
    credentials: {
      accessKeyId: environment.KLOPT_S3_ACCESS_KEY_ID!,
      secretAccessKey: environment.KLOPT_S3_SECRET_ACCESS_KEY!,
      // `us-east-1` is what MinIO reports and what S3 signs with when a bucket
      // has no region of its own. Wrong here means every signature is rejected,
      // so it is worth being explicit rather than clever.
      region: present(environment.KLOPT_S3_REGION) ? environment.KLOPT_S3_REGION! : 'us-east-1',
    },
    // Compliance unless somebody asks otherwise. It cannot be bypassed by
    // anybody, which is what the bewaarplicht wants; governance can, and exists
    // for a bucket somebody inherited.
    mode: environment.KLOPT_S3_OBJECT_LOCK_MODE === 'governance' ? 'governance' : 'compliance',
  })
}
