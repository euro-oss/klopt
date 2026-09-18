import { sha256Hex, type DocumentDeletion, type WormDocumentStore } from '@klopt/core'

/**
 * A WORM store in memory, for testing the application's side of the contract.
 *
 * ## What this is for, and what it is not for
 *
 * Two different things get called "the WORM behaviour", and only one of them
 * can be faked:
 *
 *   - **Does the storage refuse?** That is S3's behaviour, and it is pinned by
 *     `test/documents/s3.test.ts` against a real MinIO — a hand-written SigV4
 *     signature that a mock accepts proves nothing, and the delete-marker bug
 *     in the comments of that file was found *because* a real store was
 *     answering. Nothing here can stand in for that.
 *   - **Does the application report the refusal instead of claiming success?**
 *     That is our behaviour, and a store that refuses is all it needs. Making
 *     that test reach for object storage coupled a question about our handlers
 *     to somebody else's daemon being up.
 *
 * So this exists for the second. It is written to mirror the first exactly, and
 * the reason that mirroring can be trusted is that the real store is still
 * tested against a real server. If the two ever diverge, `s3.test.ts` is the
 * one that is right.
 *
 * Compliance mode, because that is what the shipped bucket is created with, and
 * a fake that was easier to get past than the real thing would be worse than
 * no fake at all.
 */

interface Held {
  readonly bytes: Uint8Array
  readonly contentType: string
  /** `YYYY-MM-DD`, or null while the term is still unknown. */
  until: string | null
}

export interface MemoryWormStoreOptions {
  /**
   * Whether the "bucket" reports object lock as enabled.
   *
   * False is the honest fixture for a store that works perfectly while
   * guaranteeing nothing — a bucket created before anybody wanted a lock. The
   * retention screen has to be able to say so rather than printing the
   * guarantee on the strength of the store's class.
   */
  readonly objectLock?: boolean
  /** What the store calls itself. The retention screen prints it. */
  readonly name?: string
}

export function createMemoryWormStore(options: MemoryWormStoreOptions = {}): WormDocumentStore {
  const objects = new Map<string, Held>()
  const objectLock = options.objectLock ?? true

  const today = (): string => new Date().toISOString().slice(0, 10)

  return {
    name: options.name ?? 'memory-worm',
    worm: { mode: 'compliance' },

    async put(bytes, metadata) {
      const sha256 = await sha256Hex(bytes)
      const existing = objects.get(sha256)
      if (existing !== undefined) {
        return { sha256, sizeBytes: existing.bytes.byteLength, ...metadata, existed: true }
      }

      // Stored unlocked: at PUT time the retention term is unknown, because it
      // is counted from the book year of whatever this turns out to be
      // evidence for. Guessing here would hold a 2018 receipt until 2033.
      objects.set(sha256, { bytes: bytes.slice(), contentType: metadata.contentType, until: null })
      return { sha256, sizeBytes: bytes.byteLength, ...metadata, existed: false }
    },

    get(sha256) {
      const held = objects.get(sha256)
      return Promise.resolve(held === undefined ? null : held.bytes.slice())
    },

    has(sha256) {
      return Promise.resolve(objects.has(sha256))
    },

    delete(sha256): Promise<DocumentDeletion> {
      const held = objects.get(sha256)
      if (held === undefined) return Promise.resolve({ outcome: 'absent' })

      // The whole point. A term that has not run out means the store refuses,
      // and the caller has to be told `locked` rather than `deleted` — a run
      // reporting success about bytes still sitting here is the worst answer
      // available.
      if (held.until !== null && held.until >= today()) {
        return Promise.resolve({ outcome: 'locked', until: held.until })
      }

      objects.delete(sha256)
      return Promise.resolve({ outcome: 'deleted' })
    },

    retain(sha256, until) {
      const held = objects.get(sha256)
      if (held === undefined) {
        return Promise.reject(new Error(`No object ${sha256} to retain.`))
      }

      // Monotonic: a term in this system only ever grows — seven years becomes
      // ten for onroerend goed — and one that could shrink would make the lock
      // worthless. Compliance mode refuses rather than quietly ignoring.
      if (held.until !== null && until < held.until) {
        return Promise.reject(
          new Error(
            `${sha256} is held until ${held.until}; ${until} is earlier, and a compliance lock cannot be shortened.`,
          ),
        )
      }

      held.until = until
      return Promise.resolve()
    },

    retentionOf(sha256) {
      const held = objects.get(sha256)
      return Promise.resolve(
        held === undefined || held.until === null
          ? null
          : { until: held.until, mode: 'compliance' },
      )
    },

    verifyLock() {
      return Promise.resolve(
        objectLock
          ? { enabled: true, reason: null }
          : {
              enabled: false,
              reason:
                'This store was created without object lock. Object lock can only be turned on at creation, so the bucket has to be recreated.',
            },
      )
    },
  }
}
