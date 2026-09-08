import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supportsWorm } from '@klopt/core'
import { createS3DocumentStore } from '../../src/documents/s3.js'

/**
 * The S3 store, against the MinIO in `compose.yaml`.
 *
 * This is the reason it was acceptable to write SigV4 out by hand rather than
 * pull in the AWS SDK (see the note in `sigv4.ts`, and ADR 0024 for the
 * contrast with the Digipoort signer that was deliberately left unwritten). A
 * wrong signature fails here, loudly, on the first request.
 *
 * The tests that matter are the ones about the lock. Anybody can store and read
 * bytes back; the point of this store is that it **refuses** to delete bytes
 * whose term has not run out, which is what turns the retention promise from
 * the application's into the storage's.
 */

const ENDPOINT = process.env['KLOPT_S3_ENDPOINT'] ?? 'http://localhost:9000'
const BUCKET = process.env['KLOPT_S3_DOCUMENTS_BUCKET'] ?? 'klopt-documents'

const store = createS3DocumentStore({
  endpoint: ENDPOINT,
  bucket: BUCKET,
  credentials: {
    accessKeyId: process.env['KLOPT_S3_ACCESS_KEY_ID'] ?? 'klopt',
    secretAccessKey: process.env['KLOPT_S3_SECRET_ACCESS_KEY'] ?? 'klopt-dev-secret',
    region: process.env['KLOPT_S3_REGION'] ?? 'us-east-1',
  },
})

/** Unique per run: the store is content-addressed and the bucket persists. */
const bytes = (marker: string): Uint8Array =>
  new TextEncoder().encode(`klopt s3 test ${marker} ${randomUUID()}`)

/** Tomorrow, so a lock is genuinely in force. */
function soon(days = 1): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

const stored: string[] = []

beforeAll(async () => {
  // Fail fast and legibly if the stack is not up, rather than fifteen times.
  const reachable = await fetch(`${ENDPOINT}/minio/health/live`).then(
    (response) => response.ok,
    () => false,
  )
  if (!reachable) {
    throw new Error(
      `No S3 at ${ENDPOINT}. Start the development stack: docker compose up -d minio minio-init`,
    )
  }
}, 30_000)

afterAll(async () => {
  // Best-effort tidy-up. Anything under a lock stays, which is the whole point
  // and is why this does not assert.
  for (const sha256 of stored) await store.delete(sha256).catch(() => undefined)
})

describe('storing and reading', () => {
  it('signs a request MinIO accepts', async () => {
    // The one assertion that proves the signer. Everything else here depends on
    // it working, so if this fails nothing below means anything.
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
    // The exports bucket is created without `--with-lock`, which makes it the
    // honest fixture for this.
    const unlocked = createS3DocumentStore({
      endpoint: ENDPOINT,
      bucket: process.env['KLOPT_S3_EXPORTS_BUCKET'] ?? 'klopt-exports',
      credentials: {
        accessKeyId: process.env['KLOPT_S3_ACCESS_KEY_ID'] ?? 'klopt',
        secretAccessKey: process.env['KLOPT_S3_SECRET_ACCESS_KEY'] ?? 'klopt-dev-secret',
        region: process.env['KLOPT_S3_REGION'] ?? 'us-east-1',
      },
    })

    const verified = await unlocked.verifyLock()
    expect(verified.enabled).toBe(false)
    expect(verified.reason).toContain('recreated')
  })
})
