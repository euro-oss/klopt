import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supportsWorm, type WormDocumentStore } from '@klopt/core'
import { startFakeS3, type FakeS3 } from '../../src/testing.js'
import { createS3DocumentStore } from '../../src/documents/s3.js'
import { signS3Request, type S3Credentials } from '../../src/documents/sigv4.js'

/**
 * The S3 store, against a bucket that behaves like one.
 *
 * By default that bucket is `startFakeS3` — an S3-compatible object-lock
 * bucket in this process, on a loopback port. The store, the signer and the
 * HTTP round trip are the real ones; only the far side of the socket is
 * standing in, which is what lets this suite run in CI with no MinIO service
 * (issue #4, ADR 0059).
 *
 * Set `KLOPT_S3_ENDPOINT` and it runs against whatever is there instead:
 *
 * ```
 * docker compose up -d minio minio-init
 * KLOPT_S3_ENDPOINT=http://localhost:9000 pnpm --filter @klopt/adapters exec vitest run
 * ```
 *
 * That is not a formality. The fake verifies signatures from the algorithm
 * rather than by asking the signer, so a dropped header or a mis-hashed payload
 * fails here — but a shared misreading of SigV4 would satisfy both sides, and
 * only a real bucket can rule that out. The specs below are written to pass
 * against either.
 *
 * The tests that matter are the ones about the lock. Anybody can store and read
 * bytes back; the point of this store is that it **refuses** to delete bytes
 * whose term has not run out, which is what turns the retention promise from
 * the application's into the storage's.
 */

const EXTERNAL = process.env['KLOPT_S3_ENDPOINT']?.trim()
/** Whether the bucket on the other end is one this file can also inspect. */
const FAKE = EXTERNAL === undefined || EXTERNAL === ''

const BUCKET = process.env['KLOPT_S3_DOCUMENTS_BUCKET'] ?? 'klopt-documents'
const UNLOCKED_BUCKET = 'klopt-exports'

const credentials: S3Credentials = {
  accessKeyId: process.env['KLOPT_S3_ACCESS_KEY_ID'] ?? 'klopt',
  secretAccessKey: process.env['KLOPT_S3_SECRET_ACCESS_KEY'] ?? 'klopt-dev-secret',
  region: process.env['KLOPT_S3_REGION'] ?? 'us-east-1',
}

let fake: FakeS3 | null = null
let endpoint: string
let store: WormDocumentStore

/** Unique per run: the store is content-addressed and a real bucket persists. */
const bytes = (marker: string): Uint8Array =>
  new TextEncoder().encode(`klopt s3 test ${marker} ${randomUUID()}`)

/** Tomorrow, so a lock is genuinely in force. */
function soon(days = 1): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

const keyFor = (sha256: string): string => `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`

const stored: string[] = []

beforeAll(async () => {
  if (FAKE) {
    fake = await startFakeS3({ credentials })
    endpoint = fake.endpoint
  } else {
    endpoint = EXTERNAL!
    // Somebody asked for a real bucket explicitly, so failing to find one is an
    // error rather than a reason to quietly test something else.
    const reachable = await fetch(`${endpoint}/minio/health/live`).then(
      (response) => response.ok,
      () => false,
    )
    if (!reachable) {
      throw new Error(
        `KLOPT_S3_ENDPOINT points at ${endpoint} and there is no S3 there. Start the development stack: docker compose up -d minio minio-init`,
      )
    }
  }

  store = createS3DocumentStore({ endpoint, bucket: BUCKET, credentials })
}, 30_000)

afterAll(async () => {
  // Best-effort tidy-up. Anything under a lock stays, which is the whole point
  // and is why this does not assert.
  for (const sha256 of stored) await store.delete(sha256).catch(() => undefined)
  await fake?.close()
})

describe('storing and reading', () => {
  it('signs a request the bucket accepts', async () => {
    // The one assertion that proves the signer reaches a bucket at all.
    // Everything else here depends on it working, so if this fails nothing
    // below means anything.
    const content = bytes('signature')
    const put = await store.put(content, { contentType: 'text/plain' })
    stored.push(put.sha256)

    expect(put.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(put.existed).toBe(false)
    expect(await store.has(put.sha256)).toBe(true)
  })

  it('reads back exactly what went in', async () => {
    const content = bytes('roundtrip')
    const put = await store.put(content, { contentType: 'application/pdf' })
    stored.push(put.sha256)

    const read = await store.get(put.sha256)
    expect(read).not.toBeNull()
    expect(Buffer.from(read!).equals(Buffer.from(content))).toBe(true)
  })

  it('is a no-op the second time, because the address is the content', async () => {
    const content = bytes('dedupe')
    const first = await store.put(content, { contentType: 'text/plain' })
    stored.push(first.sha256)

    const second = await store.put(content, { contentType: 'text/plain' })
    expect(second.sha256).toBe(first.sha256)
    expect(second.existed).toBe(true)
  })

  it('says nothing rather than failing for bytes it does not have', async () => {
    const absent = 'f'.repeat(64)
    expect(await store.get(absent)).toBeNull()
    expect(await store.has(absent)).toBe(false)
  })
})

describe('the lock', () => {
  it('declares itself a WORM store, in compliance mode', () => {
    // The retention screen reads this to say what the storage guarantees rather
    // than implying one.
    expect(supportsWorm(store)).toBe(true)
    expect(supportsWorm(store) && store.worm.mode).toBe('compliance')
  })

  it('stores bytes unlocked, because their term is not known yet', async () => {
    // The awkward and important part: a retention term is counted from the book
    // year of whatever the document turns out to be evidence for, and at PUT
    // time that is unknown. Guessing would lock a 2018 receipt until 2033 with
    // no way back.
    const put = await store.put(bytes('unlocked'), { contentType: 'text/plain' })
    stored.push(put.sha256)

    expect(await store.retentionOf(put.sha256)).toBeNull()
  })

  it('holds bytes down once the term is known', async () => {
    const put = await store.put(bytes('held'), { contentType: 'text/plain' })
    stored.push(put.sha256)

    await store.retain(put.sha256, soon(2))

    const held = await store.retentionOf(put.sha256)
    expect(held?.until).toBe(soon(2))
    expect(held?.mode).toBe('compliance')
  })

  it('refuses to delete what it is holding, and says until when', async () => {
    // The assertion the whole store exists for. Reporting this as success would
    // tell a compliance screen that statutory records were destroyed while they
    // are still sitting there.
    const put = await store.put(bytes('refused'), { contentType: 'text/plain' })
    stored.push(put.sha256)
    await store.retain(put.sha256, soon(3))

    const outcome = await store.delete(put.sha256)
    expect(outcome.outcome).toBe('locked')
    expect(outcome.outcome === 'locked' && outcome.until).toBe(soon(3))

    // And the bytes really are still there.
    expect(await store.has(put.sha256)).toBe(true)
  })

  it('extends a term but will not shorten one', async () => {
    // A term in this system only ever grows — seven years becomes ten for
    // onroerend goed — and one that could shrink would make the lock worthless.
    const put = await store.put(bytes('monotonic'), { contentType: 'text/plain' })
    stored.push(put.sha256)

    await store.retain(put.sha256, soon(2))
    await store.retain(put.sha256, soon(5))
    expect((await store.retentionOf(put.sha256))?.until).toBe(soon(5))

    await expect(store.retain(put.sha256, soon(1))).rejects.toThrow()
    expect((await store.retentionOf(put.sha256))?.until).toBe(soon(5))
  })

  it('deletes bytes nothing is holding', async () => {
    const put = await store.put(bytes('deletable'), { contentType: 'text/plain' })

    expect((await store.delete(put.sha256)).outcome).toBe('deleted')
    expect(await store.has(put.sha256)).toBe(false)
  })

  it('says absent rather than failing when there is nothing to delete', async () => {
    // A store that already lost the bytes and one that just dropped them are
    // the same state, and a retry of a half-finished run has to say so.
    expect((await store.delete('e'.repeat(64))).outcome).toBe('absent')
  })

  it('removes the version rather than hiding it behind a marker', async () => {
    // The bug a real store revealed: on a versioned bucket a plain DELETE
    // writes a delete marker, which succeeds even on a locked object and makes
    // a later HEAD answer 404. The obvious implementation therefore reported
    // `deleted` about bytes still sitting there under their lock.
    const put = await store.put(bytes('versions'), { contentType: 'text/plain' })

    expect((await store.delete(put.sha256)).outcome).toBe('deleted')
    // Gone, not hidden: putting the same bytes back is a new object rather than
    // a resurrection of the old one.
    expect((await store.delete(put.sha256)).outcome).toBe('absent')

    const again = await store.put(bytes('versions-again'), { contentType: 'text/plain' })
    stored.push(again.sha256)
    expect(again.existed).toBe(false)
  })

  /**
   * The trap itself, walked into on purpose.
   *
   * ADR 0032 says a plain DELETE on a versioned bucket hides a locked object
   * instead of removing it, and that a subsequent HEAD answers 404 about bytes
   * that are still there. That is the whole reason `delete` names versions, so
   * it is worth a test that would notice if the bucket ever stopped behaving
   * that way — which is also the standard the fake bucket is held to.
   */
  it('a DELETE that names no version hides the bytes rather than removing them', async () => {
    const put = await store.put(bytes('marker'), { contentType: 'text/plain' })
    stored.push(put.sha256)
    await store.retain(put.sha256, soon(4))

    const path = `/${BUCKET}/${keyFor(put.sha256)}`
    const target = new URL(endpoint)
    const naive = await fetch(new URL(path, target), {
      method: 'DELETE',
      headers: signS3Request({ method: 'DELETE', path, headers: {} }, credentials, target),
    })

    // It succeeded, on an object under a compliance lock.
    expect([200, 204]).toContain(naive.status)
    // And the object now answers 404, which is what made the lie plausible.
    expect(await store.has(put.sha256)).toBe(false)

    // The store's own delete names the version, so it gets the refusal.
    const outcome = await store.delete(put.sha256)
    expect(outcome.outcome).toBe('locked')
    expect(await store.has(put.sha256)).toBe(true)
  })
})

describe('what the bucket actually guarantees', () => {
  it('asks the bucket rather than assuming from the store class', async () => {
    // "This is an S3 store" and "this bucket holds bytes down" are different
    // claims. Object lock can only be enabled when a bucket is created, so a
    // stack that came up against an older bucket works perfectly while
    // guaranteeing nothing — and a compliance screen must not print the
    // guarantee on the strength of the store's class.
    const verified = await store.verifyLock()

    expect(verified.enabled).toBe(true)
    expect(verified.reason).toBeNull()
  })

  it('says so, with a reason, for a bucket without one', async () => {
    // `klopt-exports` is created without `--with-lock` — in the compose file and
    // in the fake alike — which makes it the honest fixture for this. It is a
    // fixture and nothing else: no product setting points at it, because sealed
    // snapshots go to the documents bucket where they inherit the lock and a
    // retention date (ADR 0032).
    const unlocked = createS3DocumentStore({
      endpoint,
      bucket: UNLOCKED_BUCKET,
      credentials,
    })

    const verified = await unlocked.verifyLock()
    expect(verified.enabled).toBe(false)
    expect(verified.reason).toContain('recreated')
  })
})

/**
 * What the fake bucket can test and a real one cannot.
 *
 * A refusal does not have one shape: MinIO answers 400 `InvalidRequest` with
 * "Object is WORM protected", AWS answers 403 `AccessDenied`. Matching on the
 * status alone read MinIO's refusal as a fault and threw, and matching on the
 * body alone would call a 200 containing the word a refusal — so the store
 * matches on both, and until now only one of the two branches was ever
 * exercised anywhere.
 */
describe.skipIf(!FAKE)('both shapes a refusal comes in', () => {
  it('reads an AWS-shaped refusal as a refusal', async () => {
    const aws = await startFakeS3({ credentials, refusal: 'aws' })
    try {
      const awsStore = createS3DocumentStore({
        endpoint: aws.endpoint,
        bucket: BUCKET,
        credentials,
      })
      const put = await awsStore.put(bytes('aws-refusal'), { contentType: 'text/plain' })
      await awsStore.retain(put.sha256, soon(3))

      const outcome = await awsStore.delete(put.sha256)
      expect(outcome.outcome).toBe('locked')
      expect(outcome.outcome === 'locked' && outcome.until).toBe(soon(3))
      expect(await awsStore.has(put.sha256)).toBe(true)
    } finally {
      await aws.close()
    }
  })

  it('refuses a store that signs with the wrong secret', async () => {
    // Which is what makes the rest of this file mean anything: a bucket that
    // accepted any signature would let a broken signer pass.
    const wrong = createS3DocumentStore({
      endpoint,
      bucket: BUCKET,
      credentials: { ...credentials, secretAccessKey: 'not-the-secret' },
    })

    await expect(wrong.put(bytes('wrong-secret'), { contentType: 'text/plain' })).rejects.toThrow(
      /403/,
    )
  })
})
