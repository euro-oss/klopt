import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sha256Hex, type DocumentStore, type StoredDocument } from '@klopt/core'

/**
 * A directory of documents, addressed by their hash.
 *
 * The default, and the one that needs nothing (spec 8, rule 1). A self-hoster
 * with a volume mount has document storage; nobody has to run object storage to
 * keep books.
 *
 * Two levels of fan-out — `ab/cd/abcdef…` — because a flat directory of a
 * hundred thousand files is slow to list on every filesystem that has ever
 * existed, and seven years of invoices gets there.
 *
 * Writes go to a temporary name and are renamed into place. A rename within a
 * filesystem is atomic, so a reader never sees a half-written document and a
 * crash mid-write leaves a stray temporary file rather than a corrupt one
 * answering to a hash it does not have.
 */

export interface FilesystemDocumentStoreOptions {
  readonly directory: string
}

function pathFor(directory: string, sha256: string): string {
  return join(directory, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
}

export function createFilesystemDocumentStore(
  options: FilesystemDocumentStoreOptions,
): DocumentStore {
  return {
    name: 'filesystem',

    async put(bytes, metadata): Promise<StoredDocument & { existed: boolean }> {
      const sha256 = await sha256Hex(bytes)
      const path = pathFor(options.directory, sha256)

      const existing = await stat(path).catch(() => null)
      if (existing !== null) {
        // Same bytes, same address. Nothing to write, and the caller is told so
        // — "this is the file you already had" is worth showing in an inbox.
        return {
          sha256,
          sizeBytes: existing.size,
          contentType: metadata.contentType,
          existed: true,
        }
      }

      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid.toString(36)}.tmp`
      await writeFile(temporary, bytes)
      await rename(temporary, path)

      return {
        sha256,
        sizeBytes: bytes.byteLength,
        contentType: metadata.contentType,
        existed: false,
      }
    },

    async get(sha256) {
      const bytes = await readFile(pathFor(options.directory, sha256)).catch(() => null)
      return bytes === null ? null : new Uint8Array(bytes)
    },

    async has(sha256) {
      return (await stat(pathFor(options.directory, sha256)).catch(() => null)) !== null
    },
  }
}
