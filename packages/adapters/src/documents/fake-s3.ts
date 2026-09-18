import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { buffer } from 'node:stream/consumers'
import type { S3Credentials } from './sigv4.js'

/**
 * An S3-compatible object-lock bucket, in this process, on a loopback port.
 *
 * ## Why this exists
 *
 * The S3 store's tests were written against the MinIO in `docker-compose.yml`,
 * which made `pnpm run test` — and therefore CI — depend on a container being
 * up. CI has no MinIO service, so those specs failed for a reason that had
 * nothing to do with the code, and a suite that is red on nobody's machine
 * stops being read (issue #4).
 *
 * The obvious fixes are both worse than this one. Adding MinIO to the workflow
 * makes every pull request wait on a container to pull and a bucket to be
 * created with `--with-lock`, for a guarantee the runner cannot check anyway.
 * Replacing the store with a hand-written stub at the port boundary deletes the
 * only thing the specs were for: `WormDocumentStore` has four implementations'
 * worth of subtlety in it — versions, delete markers, two refusal shapes, a
 * lock that extends and never shortens — and a stub that answers `locked`
 * because a test told it to proves none of it.
 *
 * So the seam is one level lower: real store, real signer, real HTTP, and a
 * bucket that behaves like one. Everything above the socket is the code that
 * runs in production.
 *
 * ## What it is honest about
 *
 * It speaks the six operations the store makes — put, get, head, delete,
 * setting and reading object retention — plus the two bucket-level calls it
 * needs, and it models the three behaviours the store exists to cope with:
 *
 *   - **Versions.** Every PUT is a version. A DELETE without a version id
 *     writes a *delete marker* and succeeds even when the current version is
 *     locked, which is the bug ADR 0032 records: the naive implementation
 *     reported `deleted` about bytes still sitting there. The trap is
 *     reproduced here rather than assumed gone, and `s3.test.ts` walks into it
 *     deliberately.
 *   - **Object lock.** Compliance retention, monotonic: a later date extends,
 *     an earlier one is refused. Applied per version, and absent until
 *     somebody asks for it — because bytes arrive before their term is known.
 *   - **Two refusal shapes.** MinIO answers 400 `InvalidRequest` with "Object
 *     is WORM protected"; AWS answers 403 `AccessDenied`. `refusal` picks
 *     which, so both branches of `isRetentionRefusal` get exercised. Against a
 *     real MinIO only one of them ever could be.
 *
 * ## What it cannot be
 *
 * It is not proof that AWS or MinIO would accept these signatures. It verifies
 * them — independently, from the algorithm, not by calling the signer back —
 * so a request whose signature does not cover the request that arrived is
 * rejected here, and a dropped signed header or a mis-hashed payload fails
 * loudly. But a shared misreading of SigV4 would satisfy both sides, and no
 * fake can rule that out.
 *
 * That is what the real bucket is still for, and why MinIO stays in
 * `docker-compose.yml`. Point `KLOPT_S3_ENDPOINT` at it and the same specs run
 * against the real thing:
 *
 * ```
 * docker compose up -d minio minio-init
 * KLOPT_S3_ENDPOINT=http://localhost:9000 pnpm run test
 * ```
 *
 * See `docs/decisions/0059-ci-does-not-run-minio.md`.
 */

export interface FakeS3BucketOptions {
  readonly name: string
  /**
   * Whether this bucket has object lock, which real S3 can only be told at
   * creation. A bucket without one is not a broken bucket — it is the fixture
   * `verifyLock` has to fail honestly against, which is what `klopt-exports`
   * is in the compose file.
   */
  readonly objectLock?: boolean
}

export interface FakeS3Options {
  /** Defaults to the two buckets `docker-compose.yml` creates. */
  readonly buckets?: readonly FakeS3BucketOptions[]
  readonly credentials?: S3Credentials
  /** Whose refusal to imitate when a locked version is deleted. */
  readonly refusal?: 'minio' | 'aws'
}

/** One version, as the store cannot see it: the S3 API will not say `deleteMarker` out loud. */
export interface FakeS3Version {
  readonly versionId: string
  readonly deleteMarker: boolean
  /** The instant the bucket is holding this version until, if any. */
  readonly retainUntil: string | null
  readonly sizeBytes: number
}

export interface FakeS3 {
  /** `http://127.0.0.1:<port>`, for `createS3DocumentStore`. */
  readonly endpoint: string
  readonly credentials: S3Credentials
  /**
   * Every version held for a key, newest first.
   *
   * The assertions the S3 API cannot make. "The bytes are still there behind a
   * delete marker" is invisible over the wire — a `HEAD` answers 404 — and that
   * invisibility is precisely what made the delete-marker bug survivable.
   */
  versions(key: string, bucket?: string): readonly FakeS3Version[]
  close(): Promise<void>
}

interface StoredVersion {
  readonly versionId: string
  readonly deleteMarker: boolean
  readonly body: Uint8Array
  readonly contentType: string
  readonly etag: string
  readonly lastModified: string
  retainUntil: string | null
  retainMode: 'COMPLIANCE' | 'GOVERNANCE' | null
}

interface Bucket {
  readonly objectLock: boolean
  /** Key to its versions, newest first, the way `ListObjectVersions` reports them. */
  readonly objects: Map<string, StoredVersion[]>
}

interface Refusal {
  readonly status: number
  readonly code: string
  readonly message: string
}

const DEFAULT_CREDENTIALS: S3Credentials = {
  accessKeyId: 'klopt',
  secretAccessKey: 'klopt-dev-secret',
  region: 'us-east-1',
}

const DEFAULT_BUCKETS: readonly FakeS3BucketOptions[] = [
  { name: 'klopt-documents', objectLock: true },
  { name: 'klopt-exports', objectLock: false },
]

/** S3 wants `2033-12-31T00:00:00Z`; a retention date is `2033-12-31`. */
const asInstant = (date: string): string => (date.length === 10 ? `${date}T00:00:00Z` : date)

const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex')

const md5Base64 = (bytes: Uint8Array): string =>
  createHash('md5').update(Buffer.from(bytes)).digest('base64')

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest()

function errorXml(code: string, message: string, resource: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message><Resource>${resource}</Resource></Error>`
}

/**
 * Which refusal a locked version gets.
 *
 * Both shapes are real and they disagree on the status code, which is why the
 * store matches on the status *and* the body. Nothing local could exercise the
 * AWS branch before this.
 */
function refusalFor(kind: 'minio' | 'aws'): Refusal {
  return kind === 'aws'
    ? {
        status: 403,
        code: 'AccessDenied',
        message: 'Access Denied because object protected by object lock.',
      }
    : {
        status: 400,
        code: 'InvalidRequest',
        message: 'Object is WORM protected and cannot be overwritten',
      }
}

/**
 * SigV4, verified rather than trusted, and written out separately from the
 * signer on purpose.
 *
 * Calling `signS3Request` back would check nothing: any signature it produced
 * would match, including a wrong one. Deriving the expected signature here from
 * the request that actually arrived means the verification can disagree with
 * the signer — which is the only way it can catch a signed header the client
 * dropped, a query it reordered, or a payload hash that is not the payload's.
 */
function verifySignature(
  request: IncomingMessage,
  body: Uint8Array,
  credentials: S3Credentials,
  pathname: string,
  query: URLSearchParams,
): Refusal | null {
  const authorization = request.headers['authorization']
  const parsed =
    typeof authorization === 'string'
      ? /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
          authorization,
        )
      : null

  if (parsed === null) {
    return {
      status: 403,
      code: 'AccessDenied',
      message: 'Unsigned or malformed request. Every S3 request has to be signed.',
    }
  }

  const accessKeyId = parsed[1] ?? ''
  const dateStamp = parsed[2] ?? ''
  const region = parsed[3] ?? ''
  const service = parsed[4] ?? ''
  const signedHeaders = parsed[5] ?? ''
  const signature = parsed[6] ?? ''

  if (accessKeyId !== credentials.accessKeyId) {
    return {
      status: 403,
      code: 'InvalidAccessKeyId',
      message: `No such access key ${accessKeyId}.`,
    }
  }
  if (region !== credentials.region || service !== 's3') {
    return {
      status: 403,
      code: 'SignatureDoesNotMatch',
      message: `Signed for ${region}/${service}, this bucket is ${credentials.region}/s3.`,
    }
  }

  const amzDate = request.headers['x-amz-date']
  if (typeof amzDate !== 'string' || !amzDate.startsWith(dateStamp)) {
    return {
      status: 403,
      code: 'SignatureDoesNotMatch',
      message: 'x-amz-date is missing or disagrees with the credential scope.',
    }
  }

  // The payload hash is the one check here that is not a re-derivation: the
  // body arrived, so what it hashes to is a fact rather than a restatement of
  // what the client claimed.
  const payloadHash = sha256Hex(body)
  if (request.headers['x-amz-content-sha256'] !== payloadHash) {
    return {
      status: 400,
      code: 'XAmzContentSHA256Mismatch',
      message: 'x-amz-content-sha256 is not the hash of the body that arrived.',
    }
  }

  const names = signedHeaders.split(';')
  for (const required of ['host', 'x-amz-content-sha256', 'x-amz-date']) {
    if (!names.includes(required)) {
      return {
        status: 403,
        code: 'SignatureDoesNotMatch',
        message: `${required} has to be signed, and was not.`,
      }
    }
  }

  const canonicalHeaders = names
    .map((name) => {
      const value = request.headers[name]
      return `${name}:${(Array.isArray(value) ? value.join(',') : (value ?? '')).trim()}\n`
    })
    .join('')

  // S3 signs the query it receives, so the order matters and both halves are
  // encoded. Our keys are lowercase hex with slashes, which is why nothing here
  // has to be clever about encoding.
  const canonicalQuery = [...new Set(query.keys())]
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query.get(key) ?? '')}`)
    .join('&')

  const canonicalRequest = [
    request.method ?? 'GET',
    pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n')

  // Four chained HMACs, each keyed by the last. One HMAC over a concatenated
  // string produces a plausible signature that no bucket accepts, which is the
  // mistake this is here to catch.
  const date = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp)
  const regional = hmac(date, credentials.region)
  const scoped = hmac(regional, 's3')
  const expected = hmac(hmac(scoped, 'aws4_request'), stringToSign).toString('hex')

  if (expected !== signature) {
    return {
      status: 403,
      code: 'SignatureDoesNotMatch',
      message: 'The signature does not cover the request that arrived.',
    }
  }

  return null
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  return new Uint8Array(await buffer(request))
}

export async function startFakeS3(options: FakeS3Options = {}): Promise<FakeS3> {
  const credentials = options.credentials ?? DEFAULT_CREDENTIALS
  const refusal = refusalFor(options.refusal ?? 'minio')

  const buckets = new Map<string, Bucket>(
    (options.buckets ?? DEFAULT_BUCKETS).map((bucket) => [
      bucket.name,
      { objectLock: bucket.objectLock ?? false, objects: new Map<string, StoredVersion[]>() },
    ]),
  )

  const firstBucket = [...buckets.keys()][0] ?? 'klopt-documents'

  const locked = (version: StoredVersion, now: Date): boolean =>
    version.retainUntil !== null && new Date(version.retainUntil) > now

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? '/', 'http://fake.invalid')
    const method = request.method ?? 'GET'

    const reply = (status: number, body = '', headers: Record<string, string> = {}): void => {
      const bytes = Buffer.from(body, 'utf8')
      response.writeHead(status, { 'content-length': String(bytes.byteLength), ...headers })
      // A HEAD response carries the headers and none of the body, and Node will
      // happily send one that does if asked.
      response.end(method === 'HEAD' ? undefined : bytes)
    }

    const fail = (outcome: Refusal): void =>
      reply(outcome.status, errorXml(outcome.code, outcome.message, url.pathname), {
        'content-type': 'application/xml',
      })

    // MinIO's liveness probe, so a suite can ask "is there a bucket at this
    // endpoint" with one call whichever endpoint it was pointed at.
    if (url.pathname === '/minio/health/live') {
      reply(200)
      return
    }

    void readBody(request)
      .then((body) => {
        const signatureProblem = verifySignature(
          request,
          body,
          credentials,
          url.pathname,
          url.searchParams,
        )
        if (signatureProblem !== null) {
          fail(signatureProblem)
          return
        }

        // Path-style addressing: `/bucket/key`, the way MinIO needs and the store
        // sends. A bucket-level call arrives as `/bucket/` and has no key.
        const [bucketName = '', ...rest] = url.pathname.replace(/^\//, '').split('/')
        const key = rest.join('/')
        const bucket = buckets.get(bucketName)
        const now = new Date()

        if (bucket === undefined) {
          fail({ status: 404, code: 'NoSuchBucket', message: `No bucket named ${bucketName}.` })
          return
        }

        const versions = bucket.objects.get(key) ?? []
        const current = versions[0]

        /* Bucket-level calls. */
        if (key === '') {
          if (method === 'GET' && url.searchParams.has('object-lock')) {
            // The answer that cannot be inferred from the store's class: object
            // lock is set when a bucket is created and never afterwards, so a
            // bucket made before anybody wanted one behaves normally and
            // guarantees nothing.
            if (!bucket.objectLock) {
              fail({
                status: 404,
                code: 'ObjectLockConfigurationNotFoundError',
                message: 'Object Lock configuration does not exist for this bucket',
              })
              return
            }
            reply(
              200,
              `<?xml version="1.0" encoding="UTF-8"?><ObjectLockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>`,
              { 'content-type': 'application/xml' },
            )
            return
          }

          if (method === 'GET' && url.searchParams.has('versions')) {
            const prefix = url.searchParams.get('prefix') ?? ''
            const entries: string[] = []

            for (const [objectKey, held] of bucket.objects) {
              if (!objectKey.startsWith(prefix)) continue
              held.forEach((version, index) => {
                const tag = version.deleteMarker ? 'DeleteMarker' : 'Version'
                entries.push(
                  `<${tag}><Key>${objectKey}</Key><VersionId>${version.versionId}</VersionId>` +
                    `<IsLatest>${String(index === 0)}</IsLatest><LastModified>${version.lastModified}</LastModified>` +
                    (version.deleteMarker
                      ? ''
                      : `<ETag>&quot;${version.etag}&quot;</ETag><Size>${String(version.body.byteLength)}</Size><StorageClass>STANDARD</StorageClass>`) +
                    `</${tag}>`,
                )
              })
            }

            reply(
              200,
              `<?xml version="1.0" encoding="UTF-8"?><ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
                `<Name>${bucketName}</Name><Prefix>${prefix}</Prefix><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>` +
                entries.join('') +
                `</ListVersionsResult>`,
              { 'content-type': 'application/xml' },
            )
            return
          }

          fail({
            status: 501,
            code: 'NotImplemented',
            message: `The fake bucket does not answer ${method} ${url.pathname}${url.search}.`,
          })
          return
        }

        /* Object retention, which is a body rather than headers. */
        if (url.searchParams.has('retention')) {
          if (method === 'PUT') {
            if (!bucket.objectLock) {
              fail({
                status: 400,
                code: 'InvalidRequest',
                message: 'Bucket is missing ObjectLockConfiguration',
              })
              return
            }
            // Required by the API and by nothing else here. A signed request is
            // already tamper-evident; S3 wants this anyway, so the store sends it
            // and dropping it has to fail.
            if (request.headers['content-md5'] !== md5Base64(body)) {
              fail({
                status: 400,
                code: 'InvalidDigest',
                message: 'PutObjectRetention needs a Content-MD5 of its body.',
              })
              return
            }
            if (current === undefined || current.deleteMarker) {
              fail({ status: 404, code: 'NoSuchKey', message: `No object at ${key}.` })
              return
            }

            const text = Buffer.from(body).toString('utf8')
            const mode = /<Mode>([A-Z]+)<\/Mode>/.exec(text)?.[1]
            const until = /<RetainUntilDate>([^<]+)<\/RetainUntilDate>/.exec(text)?.[1]
            if (mode === undefined || until === undefined) {
              fail({
                status: 400,
                code: 'MalformedXML',
                message: 'Retention needs a Mode and a RetainUntilDate.',
              })
              return
            }

            // Monotonic, and the store depends on it: a term in this system only
            // ever grows, and one the application could shorten would make the
            // lock worthless. Compliance mode refuses; nobody can bypass it.
            const wanted = asInstant(until)
            if (
              current.retainUntil !== null &&
              current.retainMode === 'COMPLIANCE' &&
              new Date(wanted) < new Date(current.retainUntil)
            ) {
              fail({
                status: 403,
                code: 'AccessDenied',
                message: `Retention cannot be shortened. Held until ${current.retainUntil}.`,
              })
              return
            }

            current.retainUntil = wanted
            current.retainMode = mode === 'GOVERNANCE' ? 'GOVERNANCE' : 'COMPLIANCE'
            reply(200)
            return
          }

          if (method === 'GET') {
            if (current === undefined || current.deleteMarker) {
              fail({ status: 404, code: 'NoSuchKey', message: `No object at ${key}.` })
              return
            }
            // Not 404, which is what one would guess: both MinIO and AWS answer
            // 400 NoSuchObjectLockConfiguration for an object with no lock, and
            // no lock yet is the normal state of freshly stored bytes.
            if (current.retainUntil === null) {
              fail({
                status: 400,
                code: 'NoSuchObjectLockConfiguration',
                message: 'The specified object does not have an ObjectLock configuration',
              })
              return
            }
            reply(
              200,
              `<?xml version="1.0" encoding="UTF-8"?><Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>${current.retainMode ?? 'COMPLIANCE'}</Mode><RetainUntilDate>${current.retainUntil}</RetainUntilDate></Retention>`,
              { 'content-type': 'application/xml' },
            )
            return
          }
        }

        /* The object itself. */
        if (method === 'PUT') {
          const stored: StoredVersion = {
            versionId: randomUUID(),
            deleteMarker: false,
            body,
            contentType:
              (typeof request.headers['content-type'] === 'string'
                ? request.headers['content-type']
                : undefined) ?? 'application/octet-stream',
            etag: createHash('md5').update(Buffer.from(body)).digest('hex'),
            lastModified: now.toISOString(),
            retainUntil: null,
            retainMode: null,
          }
          bucket.objects.set(key, [stored, ...versions])
          reply(200, '', { etag: `"${stored.etag}"` })
          return
        }

        if (method === 'GET' || method === 'HEAD') {
          if (current === undefined || current.deleteMarker) {
            fail({ status: 404, code: 'NoSuchKey', message: `No object at ${key}.` })
            return
          }
          const bytes = Buffer.from(current.body)
          response.writeHead(200, {
            'content-type': current.contentType,
            'content-length': String(bytes.byteLength),
            etag: `"${current.etag}"`,
            'last-modified': new Date(current.lastModified).toUTCString(),
            'x-amz-version-id': current.versionId,
          })
          response.end(method === 'HEAD' ? undefined : bytes)
          return
        }

        if (method === 'DELETE') {
          const versionId = url.searchParams.get('versionId')

          if (versionId === null) {
            // The trap, reproduced rather than assumed gone. On a versioned
            // bucket a DELETE without a version id removes nothing: it writes a
            // marker that hides the object, and it succeeds even when the current
            // version is locked. A later HEAD then answers 404 about bytes that
            // are still there, which is how the store once came to report
            // `deleted` about a record under a compliance lock (ADR 0032).
            const marker: StoredVersion = {
              versionId: randomUUID(),
              deleteMarker: true,
              body: new Uint8Array(),
              contentType: 'application/octet-stream',
              etag: '',
              lastModified: now.toISOString(),
              retainUntil: null,
              retainMode: null,
            }
            bucket.objects.set(key, [marker, ...versions])
            reply(204, '', { 'x-amz-delete-marker': 'true', 'x-amz-version-id': marker.versionId })
            return
          }

          const target = versions.find((version) => version.versionId === versionId)
          if (target === undefined) {
            reply(204)
            return
          }
          if (locked(target, now)) {
            fail(refusal)
            return
          }

          const remaining = versions.filter((version) => version.versionId !== versionId)
          if (remaining.length === 0) bucket.objects.delete(key)
          else bucket.objects.set(key, remaining)
          reply(204)
          return
        }

        fail({
          status: 501,
          code: 'NotImplemented',
          message: `The fake bucket does not answer ${method} ${url.pathname}${url.search}.`,
        })
      })
      .catch((error: unknown) => {
        // A fault in the fake is a fault in the test, and a 500 says so where an
        // unhandled rejection would take the whole run down with a stack trace
        // from a different tick.
        fail({
          status: 500,
          code: 'InternalError',
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const server: Server = createServer(handle)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The fake bucket did not get a port.')
  }

  return {
    endpoint: `http://127.0.0.1:${String(address.port)}`,
    credentials,

    versions(key, bucketName = firstBucket) {
      const held = buckets.get(bucketName)?.objects.get(key) ?? []
      return held.map((version) => ({
        versionId: version.versionId,
        deleteMarker: version.deleteMarker,
        retainUntil: version.retainUntil,
        sizeBytes: version.body.byteLength,
      }))
    },

    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    },
  }
}
