import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { createMaildirSource } from '@klopt/adapters'
import {
  backoffFor,
  closeDatabase,
  createDatabase,
  issueToken,
  runInboundPoll,
  runMigrations,
  withInboundSources,
  type Database,
} from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { documentStore } from '../src/api/document-store.js'
import { handleListInbox } from '../src/api/handlers/inbox.js'
import {
  handleAddInboundSource,
  handleListInboundSources,
  handlePollInboundSource,
  handleRemoveInboundSource,
} from '../src/api/handlers/inbound-sources.js'
import { handleCreateContact } from '../src/api/handlers/sales.js'
import { addInboundSourceBody, createContactBody } from '../src/api/schemas.js'

/**
 * Documents arriving on their own, against a real database and a real
 * directory.
 *
 * The claims worth checking here are the ones that only show up when the same
 * poll runs twice: that a message taken once is not taken again, that the file
 * is only moved aside after its documents are committed, and that a mailbox
 * that cannot be reached leaves the cursor where it was rather than skipping
 * everything that arrived while it was down.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let directory: string

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity() {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'inbound-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

/** A UBL invoice from a supplier the tests create. */
const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-2026-0042</cbc:ID>
  <cbc:IssueDate>2026-02-10</cbc:IssueDate>
  <cbc:DueDate>2026-03-12</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Leverancier B.V.</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>NL987654321B01</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Kantoorartikelen</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

/** An email with the UBL attached, a logo in the signature and an S/MIME part. */
function anEmail(options: { messageId: string; attachUbl?: boolean }): string {
  const boundary = 'grens-1'
  const ubl = Buffer.from(UBL, 'utf8').toString('base64')
  const logo = Buffer.alloc(4_000, 7).toString('base64')

  return [
    `Message-ID: ${options.messageId}`,
    'From: Facturen <facturen@leverancier.test>',
    'To: facturen@klant.test',
    'Subject: Factuur F-2026-0042',
    'Date: Tue, 10 Feb 2026 09:15:00 +0100',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Bijgaand onze factuur.',
    '',
    ...(options.attachUbl === false
      ? []
      : [
          `--${boundary}`,
          'Content-Type: application/xml; name="factuur.xml"',
          'Content-Disposition: attachment; filename="factuur.xml"',
          'Content-Transfer-Encoding: base64',
          '',
          ubl,
          '',
        ]),
    `--${boundary}`,
    'Content-Type: image/png; name="logo.png"',
    'Content-Disposition: inline; filename="logo.png"',
    'Content-ID: <logo@leverancier.test>',
    'Content-Transfer-Encoding: base64',
    '',
    logo,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

async function aSupplier(token: string) {
  await handleCreateContact(
    await context(token, uuidv7()),
    createContactBody.parse({
      number: 'CRE-0001',
      name: 'Leverancier B.V.',
      vatNumber: 'NL987654321B01',
      isCustomer: false,
      isSupplier: true,
      iban: 'NL02ABNA0123456789',
    }),
  )
}

/** A drop directory with these files in it. */
async function aDropDirectory(files: Record<string, string>): Promise<string> {
  const path = await mkdtemp(join(directory, 'postvak-'))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(path, name), content, 'utf8')
  }
  return path
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  directory = await mkdtemp(join(tmpdir(), 'klopt-inbound-'))
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
  await rm(directory, { recursive: true, force: true })
})

describe('a drop directory', () => {
  it('takes an email apart and files only the invoice', async () => {
    const { entityId, token } = await newEntity()
    await aSupplier(token)
    const path = await aDropDirectory({ 'factuur.eml': anEmail({ messageId: '<a@test>' }) })

    const result = await runInboundPoll({
      database,
      store: documentStore(),
      entityId,
      sourceId: await sourceFor(entityId, path),
      source: createMaildirSource({ directory: path, name: 'test' }),
      cursor: null,
    })

    expect(result.ok).toBe(true)
    expect(result.documents).toBe(1)

    const inbox = await handleListInbox(await context(token), { state: 'new' })
    expect(inbox.body.items).toHaveLength(1)
    // The UBL was read, and the supplier was matched from its VAT number.
    expect(inbox.body.items[0]?.parsed?.invoice.supplierInvoiceNumber).toBe('F-2026-0042')
    expect(inbox.body.items[0]?.contactNumber).toBe('CRE-0001')
    expect(inbox.body.items[0]?.source).toBe('email')

    // And the logo in the signature is not in the queue.
    expect(inbox.body.items.map((item) => item.filename)).toEqual(['factuur.xml'])
  })

  it('moves what it took, and only after it took it', async () => {
    const { entityId, token } = await newEntity()
    const path = await aDropDirectory({ 'factuur.eml': anEmail({ messageId: '<b@test>' }) })

    await runInboundPoll({
      database,
      store: documentStore(),
      entityId,
      sourceId: await sourceFor(entityId, path),
      source: createMaildirSource({ directory: path, name: 'test' }),
      cursor: null,
    })

    // Out of the way rather than gone: a mistake is recoverable with `mv`.
    expect(await readdir(path)).toEqual(['.verwerkt'])
    expect(await readdir(join(path, '.verwerkt'))).toEqual(['factuur.eml'])
    expect((await handleListInbox(await context(token), { state: 'new' })).body.items).toHaveLength(
      1,
    )
  })

  it('does not file the same message twice when the move did not happen', async () => {
    // The failure this guards: acknowledge runs after the commit, so a crash in
    // between leaves the file in place. The next poll must not produce a second
    // invoice from it.
    const { entityId, token } = await newEntity()
    const path = await aDropDirectory({ 'factuur.eml': anEmail({ messageId: '<c@test>' }) })
    const sourceId = await sourceFor(entityId, path)
    const store = documentStore()

    const source = createMaildirSource({ directory: path, name: 'test' })
    // A source that stores but never acknowledges — a crash between the two.
    const forgetful = { ...source, acknowledge: () => Promise.resolve() }

    await runInboundPoll({ database, store, entityId, sourceId, source: forgetful, cursor: null })
    await runInboundPoll({ database, store, entityId, sourceId, source: forgetful, cursor: null })

    const inbox = await handleListInbox(await context(token), { state: 'new' })
    expect(inbox.body.items).toHaveLength(1)
  })

  it('keeps a message it could file nothing out of, with the reason', async () => {
    // The answer to "I emailed it, where is it?" — out of the way, not gone.
    const { entityId, token } = await newEntity()
    const path = await aDropDirectory({
      'nieuwsbrief.eml': anEmail({ messageId: '<d@test>', attachUbl: false }),
    })

    await runInboundPoll({
      database,
      store: documentStore(),
      entityId,
      sourceId: await sourceFor(entityId, path),
      source: createMaildirSource({ directory: path, name: 'test' }),
      cursor: null,
    })

    expect((await handleListInbox(await context(token), { state: 'new' })).body.items).toEqual([])

    const aside = await handleListInbox(await context(token), { state: 'discarded' })
    expect(aside.body.items).toHaveLength(1)
    expect(aside.body.items[0]?.contentType).toBe('message/rfc822')
    expect(aside.body.items[0]?.discardedReason).toContain('logo.png')
  })

  it('files a bare UBL dropped in the directory', async () => {
    const { entityId, token } = await newEntity()
    await aSupplier(token)
    const path = await aDropDirectory({ 'factuur.xml': UBL })

    await runInboundPoll({
      database,
      store: documentStore(),
      entityId,
      sourceId: await sourceFor(entityId, path),
      source: createMaildirSource({ directory: path, name: 'test', source: 'peppol' }),
      cursor: null,
    })

    const inbox = await handleListInbox(await context(token), { state: 'new' })
    expect(inbox.body.items[0]?.source).toBe('peppol')
    expect(inbox.body.items[0]?.parsed?.invoice.total).toBe('121000')
  })

  it('records a directory that is not there, and does not throw', async () => {
    const { entityId } = await newEntity()
    const missing = join(directory, 'bestaat-niet')

    const result = await runInboundPoll({
      database,
      store: documentStore(),
      entityId,
      sourceId: await sourceFor(entityId, missing),
      source: createMaildirSource({ directory: missing, name: 'test' }),
      cursor: null,
    })

    // A directory that is not there is a configuration problem, not an error in
    // the books, and it must not take the run down with it.
    expect(result.ok).toBe(false)
    expect(result.failure).toContain('ENOENT')
  })
})

describe('configuring where post comes from', () => {
  it('records a directory and polls it on request', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const path = await aDropDirectory({ 'factuur.eml': anEmail({ messageId: '<e@test>' }) })

    const created = await handleAddInboundSource(
      await context(token, uuidv7()),
      addInboundSourceBody.parse({ kind: 'maildir', name: 'Postvak', directory: path }),
    )

    const listed = await handleListInboundSources(await context(token))
    expect(listed.body.sources).toHaveLength(1)
    expect(listed.body.sources[0]?.where).toBe(path)
    expect(listed.body.sources[0]?.lastPolledAt).toBeNull()

    const polled = await handlePollInboundSource(await context(token, uuidv7()), created.body.id)
    expect(polled.body.ok).toBe(true)
    expect(polled.body.documents).toBe(1)
    // The logo is reported rather than passed over in silence.
    expect(polled.body.skipped.map((entry) => entry.filename)).toContain('logo.png')

    const after = await handleListInboundSources(await context(token))
    expect(after.body.sources[0]?.lastPolledAt).not.toBeNull()
    expect(after.body.sources[0]?.lastError).toBeNull()
  })

  it('never returns the password', async () => {
    const { token } = await newEntity()

    await handleAddInboundSource(
      await context(token, uuidv7()),
      addInboundSourceBody.parse({
        kind: 'imap',
        name: 'Mailbox',
        host: '1.1.1.1',
        user: 'facturen@example.test',
        password: 'geheim',
      }),
    )

    const listed = await handleListInboundSources(await context(token))
    expect(JSON.stringify(listed.body)).not.toContain('geheim')
    expect(listed.body.sources[0]?.where).toBe('facturen@example.test@1.1.1.1')
  })

  it('refuses a private IMAP host', async () => {
    const { token } = await newEntity()

    await expect(
      handleAddInboundSource(
        await context(token, uuidv7()),
        addInboundSourceBody.parse({
          kind: 'imap',
          name: 'Mailbox',
          host: '127.0.0.1',
          user: 'facturen@example.test',
          password: 'geheim',
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('refuses a password rather than storing it in the clear', async () => {
    // Falling back to plaintext is the kind of quiet degradation somebody else
    // discovers later, in a dump.
    const key = process.env['KLOPT_ENCRYPTION_KEY']
    delete process.env['KLOPT_ENCRYPTION_KEY']
    const { token } = await newEntity()

    try {
      await expect(
        handleAddInboundSource(
          await context(token, uuidv7()),
          addInboundSourceBody.parse({
            kind: 'imap',
            name: 'Mailbox',
            host: '1.1.1.1',
            user: 'facturen@example.test',
            password: 'geheim',
          }),
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      expect((await handleListInboundSources(await context(token))).body.canStoreSecrets).toBe(
        false,
      )
    } finally {
      process.env['KLOPT_ENCRYPTION_KEY'] = key
    }
  })

  it('refuses a mailbox with no server, at the point it is set up', () => {
    // Checked when somebody sets it up rather than at the first poll: a mailbox
    // that silently never runs is the failure nobody notices for a month.
    expect(() =>
      addInboundSourceBody.parse({ kind: 'imap', name: 'Mailbox', user: 'x', password: 'y' }),
    ).toThrow()
  })

  it('removing a source leaves what already arrived alone', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const path = await aDropDirectory({ 'factuur.eml': anEmail({ messageId: '<f@test>' }) })

    const created = await handleAddInboundSource(
      await context(token, uuidv7()),
      addInboundSourceBody.parse({ kind: 'maildir', name: 'Postvak', directory: path }),
    )
    await handlePollInboundSource(await context(token, uuidv7()), created.body.id)
    await handleRemoveInboundSource(await context(token, uuidv7()), created.body.id)

    expect((await handleListInboundSources(await context(token))).body.sources).toEqual([])
    // The documents are the administration's, not the mailbox's.
    expect((await handleListInbox(await context(token), { state: 'new' })).body.items).toHaveLength(
      1,
    )
  })

  it('will not poll another administration’s source', async () => {
    const { token } = await newEntity()
    const other = await newEntity()
    const path = await aDropDirectory({})

    const created = await handleAddInboundSource(
      await context(other.token, uuidv7()),
      addInboundSourceBody.parse({ kind: 'maildir', name: 'Andermans', directory: path }),
    )

    await expect(
      handlePollInboundSource(await context(token, uuidv7()), created.body.id),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('needs ledger:configure to add one', async () => {
    const { entityId } = await newEntity()
    const { token: reader } = await issueToken(database, {
      entityId,
      name: 'reader',
      permissions: ['ledger:read'],
      actorKind: 'human',
      actorId: 'reader',
    })

    await expect(
      handleAddInboundSource(
        await context(reader, uuidv7()),
        addInboundSourceBody.parse({ kind: 'maildir', name: 'X', directory: '/tmp' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

/** A configured source row, so a poll has somewhere to record its outcome. */
async function sourceFor(entityId: string, path: string): Promise<string> {
  const { token } = await issueToken(database, {
    entityId,
    name: `source-${uuidv7().slice(-8)}`,
    permissions: ['*'],
    actorKind: 'human',
    actorId: 'setup',
  })
  const created = await handleAddInboundSource(
    await context(token, uuidv7()),
    addInboundSourceBody.parse({
      kind: 'maildir',
      name: `bron-${uuidv7().slice(-8)}`,
      directory: path,
    }),
  )
  return created.body.id
}

describe('a mailbox that keeps refusing', () => {
  /**
   * Every enabled source used to be polled every five minutes regardless of
   * how it went last time. A mailbox with an expired password therefore
   * produced two hundred and eighty-eight identical warnings a day, and a drop
   * directory that had been deleted produced them forever — which is exactly
   * what a development database full of old fixtures looked like once the
   * worker actually started running.
   *
   * Retrying is right. Retrying at full volume is not.
   */
  it('waits longer after each failure, and is not due in the meantime', async () => {
    const entityId = await seedEntity(database)
    const sourceId = await withInboundSources(database, (repository) =>
      repository.create({
        entityId,
        kind: 'maildir',
        name: 'Weg',
        config: { directory: '/definitely/not/here' },
        secret: null,
      }),
    )

    const due = async () =>
      (await withInboundSources(database, (repository) => repository.due())).some(
        (row) => row.id === sourceId,
      )

    // A brand new source is due immediately.
    expect(await due()).toBe(true)

    await withInboundSources(database, (repository) =>
      repository.recordPoll({
        sourceId,
        ok: false,
        cursor: null,
        messageCount: 0,
        failure: 'ENOENT',
        consecutiveFailures: 0,
      }),
    )

    // Now it is not, and will not be for five minutes.
    expect(await due()).toBe(false)

    const [after] = await database.execute(
      `select consecutive_failures, next_poll_after > now() as waiting
         from klopt.inbound_sources where id = '${sourceId}'`,
    )
    expect((after as { consecutive_failures: number }).consecutive_failures).toBe(1)
    expect((after as { waiting: boolean }).waiting).toBe(true)
  })

  it('widens the gap as failures pile up', () => {
    // Doubling from five minutes, capped at six hours: a source nobody has
    // disabled is one somebody still wants, so it never stops being retried.
    expect(backoffFor(0)).toBe(5 * 60_000)
    expect(backoffFor(1)).toBe(10 * 60_000)
    expect(backoffFor(3)).toBe(40 * 60_000)
    expect(backoffFor(20)).toBe(6 * 60 * 60_000)
  })

  it('forgets the whole debt the moment one poll works', async () => {
    const entityId = await seedEntity(database)
    const sourceId = await withInboundSources(database, (repository) =>
      repository.create({
        entityId,
        kind: 'maildir',
        name: 'Weer terug',
        config: { directory: '/tmp' },
        secret: null,
      }),
    )

    await withInboundSources(database, (repository) =>
      repository.recordPoll({
        sourceId,
        ok: false,
        cursor: null,
        messageCount: 0,
        failure: 'ENOENT',
        consecutiveFailures: 4,
      }),
    )
    await withInboundSources(database, (repository) =>
      repository.recordPoll({
        sourceId,
        ok: true,
        cursor: 'abc',
        messageCount: 2,
        failure: null,
      }),
    )

    // Due again straight away, and the next failure starts from scratch rather
    // than resuming a six-hour gap.
    const rows = await withInboundSources(database, (repository) => repository.due())
    const row = rows.find((candidate) => candidate.id === sourceId)
    expect(row?.consecutiveFailures).toBe(0)
    expect(row?.nextPollAfter).toBeNull()
  })
})
