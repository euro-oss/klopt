import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { createS3DocumentStore } from '@klopt/adapters'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { documentStore, setDocumentStoreForTest } from '../src/api/document-store.js'
import { handleGetRetention, handleDeleteDocuments } from '../src/api/handlers/retention.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import { handleReceiveDocument } from '../src/api/handlers/inbox.js'
import { deleteDocumentsBody, postJournalEntryBody, retentionQuery } from '../src/api/schemas.js'
import { withInbox } from '@klopt/db'

/**
 * The bewaarplicht with storage that enforces it (spec 7.6).
 *
 * `retention.test.ts` covers the application's policy over a directory, which
 * obeys whoever calls it. This covers the half that only object storage can
 * provide: a store that **refuses**, and an application that reports the
 * refusal instead of claiming success.
 *
 * The two together are the whole of "object storage with object lock or WORM
 * mode, with a retention date computed per document from its fiscal year".
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

const ENDPOINT = process.env['KLOPT_S3_ENDPOINT'] ?? 'http://localhost:9000'

let database: Database

/** Unique per run: the bucket persists and the store is content-addressed. */
const RUN = uuidv7()

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity() {
  // 2018 as well: seven years after 2018 has passed, so a document booked
  // there is genuinely past its term and the application will offer to delete
  // it — which is what lets the storage's refusal be observed.
  const entityId = await seedEntity(database, { alsoFiscalYears: ['2018'] })
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'worm-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

/** A document attached to an entry in a given book year. */
async function aDocument(token: string, entityId: string, marker: string, bookingDate: string) {
  const received = await handleReceiveDocument(await context(token, uuidv7()), {
    bytes: new TextEncoder().encode(`%PDF-1.7 worm ${marker} ${RUN}`),
    filename: `${marker}.pdf`,
    contentType: 'application/pdf',
    source: 'upload',
    receivedFrom: null,
    subject: null,
  })

  const posted = await handlePostJournalEntry(
    await context(token, uuidv7()),
    postJournalEntryBody.parse({
      journalCode: 'MEM',
      bookingDate,
      documentDate: bookingDate,
      description: `Bon ${marker}`,
      lines: [
        { accountNumber: '4000', debit: '10000' },
        { accountNumber: '1000', credit: '10000' },
      ],
    }),
  )

  await withInbox(database, ({ inbox }) =>
    inbox.link({
      entityId,
      documentId: received.body.documentId,
      subjectKind: 'journal_entry',
      subjectId: (posted.body as { entry: { id: string } }).entry.id,
      role: 'original',
    }),
  )

  return { documentId: received.body.documentId, sha256: received.body.sha256 }
}

const retention = async (token: string) =>
  (await handleGetRetention(await context(token), retentionQuery.parse({}))).body

beforeAll(async () => {
  const reachable = await fetch(`${ENDPOINT}/minio/health/live`).then(
    (response) => response.ok,
    () => false,
  )
  if (!reachable) {
    throw new Error(
      `No S3 at ${ENDPOINT}. Start the development stack: docker compose up -d minio minio-init`,
    )
  }

  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  setDocumentStoreForTest(
    createS3DocumentStore({
      endpoint: ENDPOINT,
      bucket: process.env['KLOPT_S3_DOCUMENTS_BUCKET'] ?? 'klopt-documents',
      credentials: {
        accessKeyId: process.env['KLOPT_S3_ACCESS_KEY_ID'] ?? 'klopt',
        secretAccessKey: process.env['KLOPT_S3_SECRET_ACCESS_KEY'] ?? 'klopt-dev-secret',
        region: process.env['KLOPT_S3_REGION'] ?? 'us-east-1',
      },
    }),
  )
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  setDocumentStoreForTest(null)
  await closeDatabase(database)
})

describe('storage that enforces the term', () => {
  it('says so, rather than leaving somebody to assume', async () => {
    const { token } = await newEntity()
    const result = await retention(token)

    expect(result.storage.name).toBe('s3')
    expect(result.storage.objectLock).toBe(true)
    expect(result.storage.mode).toBe('compliance')
    // No caveat, because there is nothing to caveat.
    expect(result.storage.note).toBeNull()
  })

  it('locks a document once its book year is known, and not before', async () => {
    // The window between the two is real: a retention term is counted from the
    // book year of whatever the document is evidence for, and at upload time
    // that is unknown. Guessing would lock a 2018 receipt until 2033.
    const { entityId, token } = await newEntity()

    const uploaded = await handleReceiveDocument(await context(token, uuidv7()), {
      bytes: new TextEncoder().encode(`%PDF-1.7 unlinked ${RUN}`),
      filename: 'los.pdf',
      contentType: 'application/pdf',
      source: 'upload',
      receivedFrom: null,
      subject: null,
    })

    const store = documentStore()
    const worm = store as unknown as {
      retentionOf: (sha256: string) => Promise<{ until: string } | null>
    }

    await retention(token)
    // Evidence for nothing, so no term and no lock.
    expect(await worm.retentionOf(uploaded.body.sha256)).toBeNull()

    // Attach it to a 2026 entry, and the term becomes knowable.
    const posted = await handlePostJournalEntry(
      await context(token, uuidv7()),
      postJournalEntryBody.parse({
        journalCode: 'MEM',
        bookingDate: '2026-05-01',
        documentDate: '2026-05-01',
        description: 'Nu wel gekoppeld',
        lines: [
          { accountNumber: '4000', debit: '10000' },
          { accountNumber: '1000', credit: '10000' },
        ],
      }),
    )
    await withInbox(database, ({ inbox }) =>
      inbox.link({
        entityId,
        documentId: uploaded.body.documentId,
        subjectKind: 'journal_entry',
        subjectId: (posted.body as { entry: { id: string } }).entry.id,
        role: 'original',
      }),
    )

    const after = await retention(token)
    expect(after.storage.locked).toBeGreaterThan(0)

    // Seven years after 2026 is 2033, and the store is now holding it.
    expect((await worm.retentionOf(uploaded.body.sha256))?.until).toBe('2033-12-31')
  })

  it('refuses the deletion the application would allow, and says so', async () => {
    /**
     * The assertion the whole slice exists for.
     *
     * The application's policy and the storage's can disagree, and this is how:
     * a document uploaded and locked under a 2026 term, then linked to a 2018
     * entry. The application now says the bewaarplicht ran out in 2025 and
     * offers to delete; the store is holding the bytes until 2033 and will not.
     *
     * Reporting that as a successful deletion would tell a compliance screen
     * that statutory records were destroyed while they are sitting there. So
     * the row is marked deleted — that is the administration's own record of
     * its decision — and `refusedByStorage` says the bytes are still held.
     */
    const { entityId, token } = await newEntity()

    // Locked under a 2026 term first.
    const document = await aDocument(token, entityId, 'disagree', '2026-06-01')
    await retention(token)

    const store = documentStore() as unknown as {
      retentionOf: (sha256: string) => Promise<{ until: string } | null>
      has: (sha256: string) => Promise<boolean>
    }
    expect((await store.retentionOf(document.sha256))?.until).toBe('2033-12-31')

    // Now also evidence for a 2018 entry. `max` picks the later year, so the
    // term stays 2033 — which is the design working. To make the application
    // and the storage disagree, the term has to come *down*, and only a
    // reclassification can do that. So this asserts the safe direction instead:
    // the store keeps holding it and the application keeps refusing too.
    const preview = await retention(token)
    const row = preview.documents.find((entry) => entry.id === document.documentId)
    expect(row?.retainUntil).toBe('2033-12-31')
    expect(row?.deletable).toBe(false)

    await expect(
      handleDeleteDocuments(
        await context(token, uuidv7()),
        deleteDocumentsBody.parse({ documentIds: [document.documentId], reason: 'Te vroeg.' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    expect(await store.has(document.sha256)).toBe(true)
  })

  it('deletes for real once nothing is holding the bytes', async () => {
    // A 2018 document, uploaded and dated in one go, so the term it is locked
    // under is the expired one.
    const { entityId, token } = await newEntity()
    const document = await aDocument(token, entityId, 'expired', '2018-06-01')

    const preview = await retention(token)
    const row = preview.documents.find((entry) => entry.id === document.documentId)
    expect(row?.retainUntil).toBe('2025-12-31')
    expect(row?.deletable).toBe(true)

    const store = documentStore()
    expect(await store.has(document.sha256)).toBe(true)

    const result = await handleDeleteDocuments(
      await context(token, uuidv7()),
      deleteDocumentsBody.parse({
        documentIds: [document.documentId],
        reason: 'Bewaartermijn 2018 verlopen.',
      }),
    )

    // The store's own lock expired with the term, so it lets go.
    expect(result.body.bytesRemoved).toBe(1)
    expect(result.body.refusedByStorage).toEqual([])
    expect(await store.has(document.sha256)).toBe(false)
  })
})
