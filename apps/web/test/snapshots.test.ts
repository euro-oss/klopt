import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7, type TimestampWitness } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { documentStore } from '../src/api/document-store.js'
import { setTimestampWitnessForTest } from '../src/api/timestamp.js'
import {
  handleGetSnapshotManifest,
  handleGetSnapshotTimestamp,
  handleListSnapshots,
  handleSealSnapshot,
  handleVerifySnapshot,
} from '../src/api/handlers/snapshots.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import { handleReceiveDocument } from '../src/api/handlers/inbox.js'
import { handleUpdateEntity } from '../src/api/handlers/setup.js'
import {
  auditLogQuery,
  postJournalEntryBody,
  sealSnapshotBody,
  updateEntityBody,
  verifySnapshotQuery,
} from '../src/api/schemas.js'

/**
 * Sealed snapshots, against a real database and a real store.
 *
 * The claims worth checking are the two that separate this from a backup: that
 * an administration which has simply *grown* still verifies, and that one whose
 * past has changed does not. A snapshot that failed on growth would be switched
 * off within a week, and one that passed on a rewrite would be worthless.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let documentDirectory: string

/** Unique per run: documents are content-addressed across administrations. */
const RUN = uuidv7()

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

/**
 * Seller details, so the fixture looks like a real administration.
 *
 * Not required by the XAF schema — that is a UBL requirement — but the export
 * carries them and a snapshot of a blank company proves less than one of a
 * filled-in company.
 */
const SELLER = {
  legalName: 'Test Beheer B.V.',
  street: 'Keizersgracht',
  houseNumber: '123-B',
  postalCode: '1015 CJ',
  city: 'Amsterdam',
  countryCode: 'NL',
  kvkNumber: '12345678',
  vatNumber: 'NL123456789B01',
}

async function newEntity() {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'snapshot-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  await handleUpdateEntity(await context(token, uuidv7()), updateEntityBody.parse(SELLER))
  return { entityId, token }
}

async function anEntry(token: string, description: string, date = '2026-03-15') {
  return handlePostJournalEntry(
    await context(token, uuidv7()),
    postJournalEntryBody.parse({
      journalCode: 'MEM',
      bookingDate: date,
      documentDate: date,
      description,
      lines: [
        { accountNumber: '4000', debit: '10000' },
        { accountNumber: '1000', credit: '10000' },
      ],
    }),
  )
}

async function aDocument(token: string, marker: string) {
  return handleReceiveDocument(await context(token, uuidv7()), {
    bytes: new TextEncoder().encode(`%PDF-1.7 ${marker} ${RUN}`),
    filename: `${marker}.pdf`,
    contentType: 'application/pdf',
    source: 'upload',
    receivedFrom: null,
    subject: null,
  })
}

const seal = async (token: string, fiscalYear = '2026') =>
  (await handleSealSnapshot(await context(token, uuidv7()), sealSnapshotBody.parse({ fiscalYear })))
    .body

const verify = async (token: string, id: string, recomputeAuditFile = false) =>
  (
    await handleVerifySnapshot(
      await context(token, uuidv7()),
      id,
      verifySnapshotQuery.parse({ recomputeAuditFile }),
    )
  ).body

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  documentDirectory = await mkdtemp(join(tmpdir(), 'klopt-snapshot-'))
  process.env['KLOPT_DOCUMENT_DIR'] = documentDirectory
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
  await rm(documentDirectory, { recursive: true, force: true })
})

describe('sealing a book year', () => {
  it('covers the chain head, the documents and the auditfile', async () => {
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')
    await aDocument(token, 'bon-1')

    const sealed = await seal(token)

    expect(sealed.seal).toMatch(/^[0-9a-f]{64}$/)
    expect(sealed.chainHead).toMatch(/^[0-9a-f]{64}$/)
    expect(sealed.entryCount).toBe(1)
    expect(sealed.documentCount).toBe(1)
    // The first snapshot chains onto nothing.
    expect(sealed.previousSeal).toBeNull()
    expect(sealed.auditFileSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(sealed.manifestSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('stores both artefacts where every other document lives', async () => {
    // So they inherit retention, deduplication and the append-only guard rather
    // than each needing their own version of all three.
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')

    const sealed = await seal(token)

    expect(await documentStore().has(sealed.auditFileSha256)).toBe(true)
    expect(await documentStore().has(sealed.manifestSha256)).toBe(true)
  })

  it('chains each seal onto the one before it', async () => {
    // For the same reason the journal chains entries: removing a snapshot from
    // the middle becomes visible rather than leaving a tidy gap.
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')

    const first = await seal(token)
    await anEntry(token, 'Tweede post')
    const second = await seal(token)

    expect(second.previousSeal).toBe(first.seal)
    expect(second.seal).not.toBe(first.seal)
  })

  it('the manifest is the artefact, and it is plain text a reader can hash', async () => {
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const document = await aDocument(token, 'bon-manifest')
    const sealed = await seal(token)

    const listed = await handleListSnapshots(await context(token))
    const manifest = await handleGetSnapshotManifest(await context(token), sealed.id)

    expect(manifest.manifest).toContain('format=klopt.sealed-snapshot.v1')
    expect(manifest.manifest).toContain(`chainHead=${sealed.chainHead ?? ''}`)
    expect(manifest.manifest).toContain(`document=${document.body.sha256}`)
    expect(listed.body.snapshots[0]?.seal).toBe(sealed.seal)
  })

  it('records the seal in the audit log as well as in its own row', async () => {
    // Two independent places to find the same number, and the audit log has its
    // own export.
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    const log = await handleListAuditLog(
      await context(token),
      auditLogQuery.parse({ action: 'snapshot.seal' }),
    )

    expect(log.body.entries[0]?.after).toMatchObject({ seal: sealed.seal, fiscalYear: '2026' })
  })

  it('refuses a book year the administration does not have', async () => {
    // The reachable failure. A missing seller address breaks a *UBL* invoice,
    // not an XAF — the auditfile schema does not ask for one — so the honest
    // test of the refusal path is a year with nothing in it.
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')

    await expect(seal(token, '2019')).rejects.toThrow()
  })
})

describe('verifying a snapshot', () => {
  it('passes when nothing has changed', async () => {
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    const result = await verify(token, sealed.id)
    expect(result.verified).toBe(true)
    expect(result.drift).toEqual([])
  })

  it('passes when the administration has simply grown', async () => {
    // The claim the whole design rests on. New entries move the chain head and
    // new documents lengthen the manifest, and a snapshot that called either
    // one drift would be switched off within a week.
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    await anEntry(token, 'Latere post')
    await aDocument(token, 'bon-later')

    const result = await verify(token, sealed.id)
    expect(result.verified).toBe(true)
  })

  it('records what it found, and says whether it looked at the auditfile', async () => {
    // "Verified" with a check skipped is a lie by omission.
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    const cheap = await verify(token, sealed.id, false)
    expect(cheap.auditFileChecked).toBe(false)

    const full = await verify(token, sealed.id, true)
    expect(full.auditFileChecked).toBe(true)
    expect(full.verified).toBe(true)

    const listed = await handleListSnapshots(await context(token))
    const row = listed.body.snapshots.find((entry) => entry.id === sealed.id)
    expect(row?.verifiedOk).toBe(true)
    expect(row?.verifiedAt).not.toBeNull()
  })

  it('reports an entry whose content was rewritten but whose hash was not', async () => {
    // The case a comparison of chain heads cannot see, and the reason
    // verification recomputes the chain: the head is the last entry's *stored*
    // hash, so rewriting a description moves nothing. Found by a walk-through.
    const { entityId, token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    await database.execute(`alter table klopt.journal_entries disable trigger user`)
    try {
      await database.execute(
        `update klopt.journal_entries set description = 'herschreven'
         where entity_id = '${entityId}' and chain_sequence = 1`,
      )
    } finally {
      await database.execute(`alter table klopt.journal_entries enable trigger user`)
    }

    const result = await verify(token, sealed.id)
    expect(result.verified).toBe(false)
    expect(result.chainVerified).toBe(false)
    expect(result.drift.map((entry) => entry.code)).toContain('chain_broken')
  })

  it('reports a rewritten entry whose hash was rewritten with it', async () => {
    // Around the API, with raw SQL, because that is the threat model: the guard
    // and the seal have to hold for anybody with the connection string.
    const { entityId, token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    // The append-only trigger refuses an UPDATE, so tamper by disabling it —
    // which is exactly what somebody with database access would do, and what
    // the seal exists to catch afterwards.
    await database.execute(`alter table klopt.journal_entries disable trigger user`)
    try {
      await database.execute(
        `update klopt.journal_entries set hash = repeat('f', 64)
         where entity_id = '${entityId}'`,
      )
    } finally {
      await database.execute(`alter table klopt.journal_entries enable trigger user`)
    }

    const result = await verify(token, sealed.id)
    expect(result.verified).toBe(false)
    expect(result.drift.map((entry) => entry.code)).toContain('chain_head_changed')
  })

  it('reports a document that vanished without being deleted', async () => {
    // A deletion under the bewaarplicht keeps its row and its hash; a document
    // that is simply gone is the case this catches.
    const { entityId, token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const document = await aDocument(token, 'bon-vanish')
    const sealed = await seal(token)

    await database.execute(`alter table klopt.documents disable trigger user`)
    try {
      await database.execute(
        `delete from klopt.document_links where document_id = '${document.body.documentId}';
         delete from klopt.inbox_items where document_id = '${document.body.documentId}';
         delete from klopt.documents where id = '${document.body.documentId}' and entity_id = '${entityId}'`,
      )
    } finally {
      await database.execute(`alter table klopt.documents enable trigger user`)
    }

    const result = await verify(token, sealed.id)
    expect(result.verified).toBe(false)
    expect(result.drift.map((entry) => entry.code)).toContain('document_missing')
  })

  it('reports a tampered manifest, and nothing drawn from it', async () => {
    const { entityId, token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    await database.execute(`alter table klopt.sealed_snapshots disable trigger user`)
    try {
      await database.execute(
        `update klopt.sealed_snapshots set manifest = manifest || 'tampered'
         where entity_id = '${entityId}' and id = '${sealed.id}'`,
      )
    } finally {
      await database.execute(`alter table klopt.sealed_snapshots enable trigger user`)
    }

    const result = await verify(token, sealed.id)
    expect(result.verified).toBe(false)
    expect(result.drift).toHaveLength(1)
    expect(result.drift[0]?.code).toBe('seal_broken')
  })

  it('shows one administration nothing of another', async () => {
    const { token } = await newEntity()
    const other = await newEntity()
    await anEntry(other.token, 'Andermans post')
    const theirs = await seal(other.token)

    expect((await handleListSnapshots(await context(token))).body.snapshots).toEqual([])
    await expect(verify(token, theirs.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('lets anybody who can read the books see that a seal exists', async () => {
    // A seal nobody can see is a seal nobody checks. Producing one needs
    // `ledger:export`; seeing that one exists does not.
    const { entityId, token } = await newEntity()
    await anEntry(token, 'Eerste post')
    await seal(token)

    const { token: reader } = await issueToken(database, {
      entityId,
      name: 'reader',
      permissions: ['ledger:read'],
      actorKind: 'human',
      actorId: 'reader',
    })

    const listed = await handleListSnapshots(await context(reader))
    expect(listed.body.snapshots).toHaveLength(1)

    await expect(
      handleSealSnapshot(
        await context(reader, uuidv7()),
        sealSnapshotBody.parse({ fiscalYear: '2026' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('what the database refuses', () => {
  it('will not let a sealed snapshot be edited or removed', async () => {
    const { entityId, token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    const failed = async (statement: string) =>
      database.execute(statement).then(
        () => null,
        (error: unknown) => {
          const messages: string[] = []
          let current: unknown = error
          while (current instanceof Error) {
            messages.push(current.message)
            current = current.cause
          }
          return messages.join('\n')
        },
      )

    expect(
      await failed(
        `update klopt.sealed_snapshots set seal = repeat('a', 64)
         where entity_id = '${entityId}' and id = '${sealed.id}'`,
      ),
    ).toMatch(/cannot change/)

    expect(
      await failed(
        `delete from klopt.sealed_snapshots where entity_id = '${entityId}' and id = '${sealed.id}'`,
      ),
    ).toMatch(/append-only/)
  })

  it('does let the result of checking one be written', async () => {
    // The outcome is not part of what was sealed — it is what somebody found.
    const { token } = await newEntity()
    await anEntry(token, 'Eerste post')
    const sealed = await seal(token)

    await verify(token, sealed.id)

    const listed = await handleListSnapshots(await context(token))
    expect(listed.body.snapshots.find((row) => row.id === sealed.id)?.verifiedAt).not.toBeNull()
  })
})

/**
 * A seal somebody outside has seen (spec 7.6, ADR 0058).
 *
 * The sealed snapshot is complete except for one thing: it is entirely ours.
 * An inspector asking when a year was sealed has our own word for the date, in
 * the one situation where our word is what is in question. An RFC 3161
 * authority signs "I saw this hash at this time" — and these tests are about
 * what happens when it does, and rather more about what happens when it does
 * not.
 */

/** The golden reply from `openssl ts -reply`, and the hash it attests to. */
const REPLY = new Uint8Array(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'packages',
      'core',
      'test',
      'snapshot',
      '__fixtures__',
      'reply.tsr',
    ),
  ),
)
const REPLY_IMPRINT = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

/**
 * The same reply, with the imprint swapped for another hash.
 *
 * The signature no longer covers it, which is fine and deliberate: nothing in
 * Klopt verifies a TSA signature — that needs the authority's certificate
 * chain and a trust decision belonging to whoever is checking the evidence.
 * What Klopt does check is that the token attests to *this* seal, and patching
 * the imprint is the honest way to exercise exactly that.
 */
function replyAbout(sha256: string): Uint8Array {
  const wanted = Uint8Array.from(REPLY_IMPRINT.match(/../g)!, (pair) => Number.parseInt(pair, 16))
  const patched = REPLY.slice()

  let found = 0
  for (let at = 0; at + wanted.length <= patched.length; at += 1) {
    if (wanted.every((byte, index) => patched[at + index] === byte)) {
      patched.set(
        Uint8Array.from(sha256.match(/../g)!, (pair) => Number.parseInt(pair, 16)),
        at,
      )
      found += 1
    }
  }
  if (found !== 1) throw new Error(`Expected one imprint in the fixture, found ${String(found)}.`)
  return patched
}

/** An authority that stamps whatever it is shown. */
function aWitness(options: { readonly attestsTo?: string } = {}): TimestampWitness {
  return {
    name: 'https://tsa.test/tsr',
    stamp: (sha256: string) =>
      Promise.resolve({
        kind: 'stamped' as const,
        authority: 'https://tsa.test/tsr',
        token: {
          // `attestsTo` lets a test hand back a token about a *different*
          // hash, which is the corruption the verification has to notice.
          token: Buffer.from(replyAbout(options.attestsTo ?? sha256)).toString('base64'),
          genTime: '2026-09-17T12:26:19Z',
          serialNumber: '2',
          policyOid: '1.2.3.4.1',
          imprintSha256: sha256,
        },
      }),
  }
}

describe('a witness to a seal', () => {
  afterEach(() => {
    setTimestampWitnessForTest(null)
  })

  it('records what the authority said, on its clock and not ours', async () => {
    const { token } = await newEntity()
    await anEntry(token, 'Getuige')
    setTimestampWitnessForTest(aWitness())

    const sealed = await seal(token)

    expect(sealed.timestamp.witnessed).toBe(true)
    expect(sealed.timestamp.authority).toBe('https://tsa.test/tsr')
    // The authority's own `genTime`, not `new Date()`. Recording ours would
    // make the column say the opposite of what it is there for.
    expect(sealed.timestamp.at).toBe('2026-09-17T12:26:19Z')
    expect(sealed.timestamp.reason).toBeNull()

    const listed = await handleListSnapshots(await context(token))
    expect(listed.body.snapshots[0]?.timestamp.witnessed).toBe(true)
    expect(listed.body.snapshots[0]?.timestamp.serialNumber).toBe('2')
  })

  it('hands over the reply as a file somebody else can check', async () => {
    // The point of the feature: publishing a seal outside this instance means
    // giving somebody the bytes `openssl ts -verify` takes.
    const { token } = await newEntity()
    await anEntry(token, 'Uitgifte')
    setTimestampWitnessForTest(aWitness())
    const sealed = await seal(token)

    const handed = await handleGetSnapshotTimestamp(await context(token), sealed.id)

    expect(handed.filename).toMatch(/^snapshot-2026-[0-9a-f]{12}\.tsr$/)
    // The authority's bytes, unchanged through storage and base64. Not "a
    // file": `openssl ts -verify` checks a signature over exactly these, and
    // one byte of helpfulness in the middle would break it.
    expect(new Uint8Array(handed.token)).toEqual(replyAbout(sealed.seal))
  })

  it('seals anyway when the authority cannot be reached, and says why', async () => {
    /**
     * The property that matters most. A scheduled sealing run that stopped
     * producing evidence because somebody else's endpoint was down would be
     * worse than one that occasionally produces evidence with no witness — the
     * seal detects a change either way.
     */
    const { token } = await newEntity()
    await anEntry(token, 'Zonder getuige')
    setTimestampWitnessForTest({
      name: 'https://tsa.test/tsr',
      stamp: () => Promise.resolve({ kind: 'unavailable' as const, reason: 'Connection refused.' }),
    })

    const sealed = await seal(token)

    expect(sealed.seal).toMatch(/^[0-9a-f]{64}$/)
    expect(sealed.timestamp.witnessed).toBe(false)
    expect(sealed.timestamp.reason).toBe('Connection refused.')

    // And nothing to hand over, with the reason rather than a bare 404 that
    // reads like the snapshot is missing.
    await expect(handleGetSnapshotTimestamp(await context(token), sealed.id)).rejects.toThrow(
      /Connection refused/,
    )
  })

  it('has no witness at all by default, and names the setting', async () => {
    // Spec 8's first rule: a fresh install needs no third party. The absence
    // is reported with the thing to set rather than as a bare null.
    const { token } = await newEntity()
    await anEntry(token, 'Standaard')

    const sealed = await seal(token)

    expect(sealed.timestamp.witnessed).toBe(false)
    expect(sealed.timestamp.reason).toContain('KLOPT_TIMESTAMP_URL')
  })

  it('reports the witness as unchecked when there is none', async () => {
    const { token } = await newEntity()
    await anEntry(token, 'Niets te checken')
    const sealed = await seal(token)

    const checked = await verify(token, sealed.id)

    // Neither true nor false: a boolean would make a snapshot with no
    // timestamp look either verified or broken, and it is neither.
    expect(checked.timestamp.witnessed).toBe(false)
    expect(checked.timestamp.ok).toBeNull()
  })

  it('confirms a token that really does attest to this seal', async () => {
    const { token } = await newEntity()
    await anEntry(token, 'Klopt')
    setTimestampWitnessForTest(aWitness())
    const sealed = await seal(token)

    const checked = await verify(token, sealed.id)

    expect(checked.timestamp.witnessed).toBe(true)
    expect(checked.timestamp.ok).toBe(true)
    // Read out of the reply itself, not off the column beside it — the column
    // is what would have been edited too.
    expect(checked.timestamp.at).toBe('2026-09-17T12:26:19Z')
  })

  it('notices a token that attests to a different seal', async () => {
    /**
     * The one failure the rest of the verification cannot see: a row whose
     * seal was edited while its token was left alone would otherwise present
     * somebody else's timestamp as evidence for a number it never covered.
     */
    const { token } = await newEntity()
    await anEntry(token, 'Verwisseld')
    setTimestampWitnessForTest(aWitness({ attestsTo: 'a'.repeat(64) }))
    const sealed = await seal(token)

    const checked = await verify(token, sealed.id)

    expect(checked.timestamp.witnessed).toBe(true)
    expect(checked.timestamp.ok).toBe(false)
  })
})
