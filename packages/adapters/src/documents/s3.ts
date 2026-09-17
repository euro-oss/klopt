import { createHash } from 'node:crypto'
import { sha256Hex, type DocumentDeletion, type WormDocumentStore } from '@klopt/core'
import { signS3Request, type S3Credentials } from './sigv4.js'

/**
 * Documents in S3-compatible storage, held down by object lock (spec 7.6).
 *
 * > "Object storage with object lock or WORM mode, with a retention date
 * > computed per document from its fiscal year."
 *
 * This is what turns the retention promise from the application's into the
 * storage's. The filesystem store obeys whoever calls it; this one refuses.
 *
 * ## The lock is applied when the term is known, not when the bytes arrive
 *
 * The awkward and important part. Object lock is set per object and can be
 * extended but never shortened — and at the moment bytes arrive their term is
 * *unknown*, because it is counted from the book year of whatever the document
 * turns out to be evidence for (ADR 0030). A receipt uploaded today might
 * belong to 2018.
 *
 * Guessing at PUT time would lock that receipt until 2033 and, in compliance
 * mode, nothing could ever undo it. So bytes are stored unlocked and `retain`
 * is called when the term is derived. The window between the two is real, and
 * the retention screen counts it rather than hiding it: an object with no lock
 * yet is protected by the application and not by the storage.
 *
 * ## Compliance by default
 *
 * `compliance` cannot be bypassed by anybody, including the account root.
 * `governance` can, by a caller holding `s3:BypassGovernanceRetention`. The
 * bewaarplicht wants the first, and the cost is that a term set too long is
 * permanent — which costs storage rather than compliance, and is the safe
 * direction. It is configurable because somebody migrating an existing bucket
 * may not have the choice.
 *
 * ## Keys are hashes, which removes a whole class of bug
 *
 * The object key is the content hash, fanned out two levels — `ab/cd/abcd…` —
 * for the same reason the filesystem store does it. Lowercase hex has no
 * characters that need URI encoding, so the signing path never has to be clever
 * about it.
 */

export interface S3DocumentStoreOptions {
  /** `http://localhost:9000` for MinIO, `https://s3.eu-west-1.amazonaws.com` for AWS. */
  readonly endpoint: string
  readonly bucket: string
  readonly credentials: S3Credentials
  /**
   * Path-style addressing, which MinIO needs and AWS accepts. Virtual-hosted
   * style would put the bucket in the hostname, and a bucket name with a dot in
   * it then breaks TLS — so path style is the default rather than the fallback.
   */
  readonly forcePathStyle?: boolean | undefined
  readonly mode?: 'compliance' | 'governance' | undefined
}

function keyFor(sha256: string): string {
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`
}

/** S3 wants `2033-12-31T00:00:00Z`; a retention date is `2033-12-31`. */
function asInstant(date: string): string {
  return date.length === 10 ? `${date}T00:00:00Z` : date
}

/** And back again, because the domain works in dates. */
function asDate(instant: string): string {
  return instant.slice(0, 10)
}

/**
 * The one bit of XML this store speaks.
 *
 * `PutObjectRetention` takes a body rather than headers, unlike PUT, and it is
 * three elements — not worth a parser in either direction.
 */
function retentionBody(mode: string, until: string): string {
  return `<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>${mode.toUpperCase()}</Mode><RetainUntilDate>${asInstant(until)}</RetainUntilDate></Retention>`
}

function readRetention(xml: string): { readonly until: string; readonly mode: string } | null {
  const mode = /<Mode>([A-Z]+)<\/Mode>/.exec(xml)?.[1]
  const until = /<RetainUntilDate>([^<]+)<\/RetainUntilDate>/.exec(xml)?.[1]
  if (mode === undefined || until === undefined) return null
  return { until: asDate(until), mode: mode.toLowerCase() }
}

/**
 * Whether the store refused because of its own retention.
 *
 * Both halves are needed. The status alone is not enough — MinIO uses 400 where
 * AWS uses 403 — and the body alone is not enough either, because a 200 that
 * happens to contain the word is not a refusal.
 */
function isRetentionRefusal(status: number, body: string): boolean {
  if (status === 403 || status === 409) return true
  return (
    status === 400 &&
    (body.includes('WORM protected') || body.includes('ObjectLocked') || body.includes('retention'))
  )
}

export class S3StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'S3StoreError'
  }
}

/**
 * `Content-MD5`, which `PutObjectRetention` requires and nothing else here does.
 *
 * Not a security property — the request is already signed — but the API refuses
 * the call without it, which is a fact about S3 rather than a choice.
 */
function createContentMd5(body: Uint8Array): string {
  return createHash('md5').update(Buffer.from(body)).digest('base64')
}

export function createS3DocumentStore(options: S3DocumentStoreOptions): WormDocumentStore {
  const endpoint = new URL(options.endpoint)
  const mode = options.mode ?? 'compliance'
  const pathStyle = options.forcePathStyle ?? true

  /**
   * Cached: object lock can only be enabled when a bucket is created, so the
   * answer cannot change while this process is running.
   */
  let lockChecked: { enabled: boolean; reason: string | null } | null = null

  async function send(request: {
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'
    key: string
    query?: Record<string, string>
    headers?: Record<string, string>
    body?: Uint8Array
  }): Promise<Response> {
    const path = pathStyle ? `/${options.bucket}/${request.key}` : `/${request.key}`

    const url = new URL(path, endpoint)
    for (const [name, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(name, value)
    }

    const headers = signS3Request(
      {
        method: request.method,
        path,
        ...(request.query === undefined ? {} : { query: request.query }),
        headers: request.headers ?? {},
        ...(request.body === undefined ? {} : { body: request.body }),
      },
      options.credentials,
      pathStyle ? endpoint : new URL(`${endpoint.protocol}//${options.bucket}.${endpoint.host}`),
    )

    return fetch(url, {
      method: request.method,
      headers,
      ...(request.body === undefined
        ? {}
        : { body: Buffer.from(request.body) as unknown as BodyInit }),
    })
  }

  /**
   * Every version of one object, newest first.
   *
   * A bucket-level call rather than an object-level one — S3 has no "list the
   * versions of this key" — so the prefix is the key and the results are
   * filtered to it exactly. A prefix match would otherwise return neighbours,
   * and with hashes for keys that cannot happen, but relying on that would be
   * relying on the wrong thing.
   */
  async function listVersions(key: string): Promise<string[]> {
    const response = await send({
      method: 'GET',
      key: '',
      query: { versions: '', prefix: key },
    })
    if (!response.ok) await refuse(response, `Listing versions of ${key}`)

    const xml = await response.text()
    const versions: string[] = []

    // Both `<Version>` and `<DeleteMarker>` carry a `<VersionId>`, and both
    // have to go: a marker left behind keeps the object hidden, which would
    // make a later put of the same bytes look like a new document.
    for (const block of xml.split(/<\/(?:Version|DeleteMarker)>/)) {
      if (!block.includes(`<Key>${key}</Key>`)) continue
      const versionId = /<VersionId>([^<]+)<\/VersionId>/.exec(block)?.[1]
      if (versionId !== undefined) versions.push(versionId)
    }

    return versions
  }

  async function refuse(response: Response, what: string): Promise<never> {
    const body = await response.text().catch(() => '')
    throw new S3StoreError(
      `${what} failed: ${String(response.status)} ${response.statusText}. ${body.slice(0, 400)}`,
      response.status,
      body,
    )
  }

  return {
    name: 's3',
    worm: { mode },

    async put(bytes, metadata) {
      const sha256 = await sha256Hex(bytes)

      // Content addressing makes this free: the same bytes are the same object,
      // so a second put is a no-op and the caller is told so.
      const existing = await send({ method: 'HEAD', key: keyFor(sha256) })
      if (existing.ok) {
        return {
          sha256,
          sizeBytes: bytes.byteLength,
          contentType: metadata.contentType,
          existed: true,
        }
      }

      // Deliberately no object-lock headers. The term is not known yet — see
      // the note at the top — and a lock set now could never be shortened.
      const response = await send({
        method: 'PUT',
        key: keyFor(sha256),
        headers: { 'content-type': metadata.contentType },
        body: bytes,
      })
      if (!response.ok) await refuse(response, `Storing ${sha256}`)

      return {
        sha256,
        sizeBytes: bytes.byteLength,
        contentType: metadata.contentType,
        existed: false,
      }
    },

    async get(sha256) {
      const response = await send({ method: 'GET', key: keyFor(sha256) })
      if (response.status === 404) return null
      if (!response.ok) await refuse(response, `Reading ${sha256}`)

      return new Uint8Array(await response.arrayBuffer())
    },

    async has(sha256) {
      const response = await send({ method: 'HEAD', key: keyFor(sha256) })
      if (response.status === 404) return false
      if (!response.ok) await refuse(response, `Checking ${sha256}`)
      return true
    },

    /**
     * Ask the store to hold these bytes until a date.
     *
     * Monotonic by the store's own rule: a later date extends, an earlier one is
     * refused in compliance mode. Both are right — a term in this system only
     * ever grows, from seven years to ten for onroerend goed, and one that could
     * shrink would make the lock worthless.
     */
    async retain(sha256, until) {
      const body = new TextEncoder().encode(retentionBody(mode, until))
      const response = await send({
        method: 'PUT',
        key: keyFor(sha256),
        query: { retention: '' },
        headers: {
          'content-type': 'application/xml',
          'content-md5': createContentMd5(body),
        },
        body,
      })

      if (!response.ok) await refuse(response, `Holding ${sha256} until ${until}`)
    },

    /**
     * Ask the bucket whether object lock is actually on.
     *
     * `GetObjectLockConfiguration` answers 404 with
     * `ObjectLockConfigurationNotFoundError` for a bucket without one — which
     * is the case worth catching, because everything else about such a bucket
     * behaves normally right up to the moment somebody deletes a statutory
     * record.
     */
    async verifyLock() {
      if (lockChecked !== null) return lockChecked

      try {
        const response = await send({ method: 'GET', key: '', query: { 'object-lock': '' } })
        const body = await response.text()

        lockChecked = response.ok
          ? {
              enabled: body.includes('<ObjectLockEnabled>Enabled</ObjectLockEnabled>'),
              reason: null,
            }
          : {
              enabled: false,
              reason: `Bucket ${options.bucket} has no object lock configuration. It can only be enabled when a bucket is created, so this one has to be recreated with it.`,
            }
      } catch (error: unknown) {
        // Unreachable storage is not the same as an unlocked bucket, and
        // claiming either way would be worse than saying so.
        lockChecked = {
          enabled: false,
          reason: `Could not ask ${options.bucket} whether object lock is on: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      return lockChecked
    },

    async retentionOf(sha256) {
      const response = await send({
        method: 'GET',
        key: keyFor(sha256),
        query: { retention: '' },
      })

      if (response.status === 404) return null

      // MinIO and AWS both answer 400 `NoSuchObjectLockConfiguration` for an
      // object with no lock — not 404, which is what one would guess. No lock
      // yet is a normal answer here, because bytes are stored before their term
      // is known.
      const text = await response.text()
      if (!response.ok) {
        if (text.includes('NoSuchObjectLockConfiguration')) return null
        await refuse(response, `Reading the lock on ${sha256}`)
      }

      return readRetention(text)
    },

    /**
     * Remove the bytes, or say why the store will not.
     *
     * ## Versions, not keys — which a real store had to teach me
     *
     * Object lock requires a versioned bucket, and on a versioned bucket a
     * `DELETE` without a version id does not remove anything: it writes a
     * *delete marker* that hides the object. That call **succeeds on a locked
     * object**, and a subsequent `HEAD` then answers 404 because the marker is
     * now current.
     *
     * So the obvious implementation reported `deleted` for bytes that were
     * still sitting there under their lock — the exact lie the three-way
     * outcome exists to prevent, and one only a real store revealed. The
     * filesystem store cannot show it, and neither can a mock.
     *
     * The version has to be named. Each one is deleted by id, a locked version
     * comes back 403, and the whole call reports `locked` rather than pretending
     * the rest succeeded.
     */
    async delete(sha256): Promise<DocumentDeletion> {
      const versions = await listVersions(keyFor(sha256))
      if (versions.length === 0) return { outcome: 'absent' }

      let locked: string | null | undefined
      let removed = 0

      for (const versionId of versions) {
        const response = await send({
          method: 'DELETE',
          key: keyFor(sha256),
          query: { versionId },
        })

        if (response.ok || response.status === 204) {
          removed += 1
          continue
        }

        // The refusal does not have one shape. MinIO answers **400
        // InvalidRequest** with "Object is WORM protected and cannot be
        // overwritten"; AWS answers **403 AccessDenied**. Matching only on the
        // status would have read MinIO's refusal as a fault and thrown, which
        // is a different wrong answer from the one this replaced.
        const body = await response.text().catch(() => '')
        if (isRetentionRefusal(response.status, body)) {
          const held = await this.retentionOf(sha256).catch(() => null)
          locked = held?.until ?? null
          continue
        }

        throw new S3StoreError(
          `Deleting ${sha256} failed: ${String(response.status)} ${response.statusText}. ${body.slice(0, 400)}`,
          response.status,
          body,
        )
      }

      // Any version still held means the bytes are still there, whatever else
      // was removed. Saying `deleted` because some versions went would be the
      // same lie in a smaller form.
      if (locked !== undefined) return { outcome: 'locked', until: locked }
      return removed > 0 ? { outcome: 'deleted' } : { outcome: 'absent' }
    },
  }
}
