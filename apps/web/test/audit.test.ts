import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleExportAuditLog, handleListAuditLog } from '../src/api/handlers/audit.js'
import { handleCreateContact, handleUpdateContact } from '../src/api/handlers/sales.js'
import { handleUpdateEntity } from '../src/api/handlers/setup.js'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
  handleTransitionPurchaseInvoice,
} from '../src/api/handlers/purchase.js'
import { handleCreateBatch, handleTransitionBatch } from '../src/api/handlers/payments.js'
import { handleCreateBankAccount } from '../src/api/handlers/bank.js'
import {
  auditLogExportQuery,
  auditLogQuery,
  bookPurchaseInvoiceBody,
  capturePurchaseInvoiceBody,
  createBankAccountBody,
  createBatchBody,
  createContactBody,
  transitionBatchBody,
  transitionPurchaseInvoiceBody,
  updateContactBody,
  updateEntityBody,
} from '../src/api/schemas.js'

/**
 * The audit log (spec 7.6), against a real database.
 *
 * The table and its append-only trigger have existed since M0 and three places
 * wrote to it. Everything else left no trace, which is the worst shape an audit
 * log can have: the hole is invisible, so the reader concludes nothing
 * happened.
 *
 * These tests are the enforcement. `recordAudit` is a call a handler can
 * forget, and the only way to know it did not is to drive the action and look.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    'x-request-id': 'req-audit-test',
    'x-forwarded-for': '198.51.100.7',
  })
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
    name: 'audit-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

/** Every audit row for this administration, oldest last. */
async function log(token: string) {
  const result = await handleListAuditLog(await context(token), auditLogQuery.parse({}))
  return result.body.entries
}

const actions = async (token: string) => (await log(token)).map((entry) => entry.action)

async function aSupplier(token: string) {
  await handleCreateContact(
    await context(token, uuidv7()),
    createContactBody.parse({
      number: 'CRE-0001',
      name: 'Leverancier B.V.',
      isCustomer: false,
      isSupplier: true,
      iban: 'NL02ABNA0123456789',
    }),
  )
}

const capture = () =>
  capturePurchaseInvoiceBody.parse({
    contactNumber: 'CRE-0001',
    supplierInvoiceNumber: 'F-2026-0042',
    invoiceDate: '2026-02-10',
    dueDate: '2026-03-12',
    net: '100000',
    tax: '21000',
    total: '121000',
    lines: [
      {
        description: 'Kantoorartikelen',
        accountNumber: '4000',
        taxCode: 'VH21',
        net: '100000',
        tax: '21000',
      },
    ],
  })

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('what gets written down', () => {
  it('records who did it, from where, and under which request', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    const [entry] = await log(token)
    expect(entry?.action).toBe('sales.createContact')
    expect(entry?.actor.kind).toBe('human')
    expect(entry?.requestId).toBe('req-audit-test')
    expect(entry?.ip).toBe('198.51.100.7')
  })

  it('records both sides of a correction', async () => {
    // The useful columns. "The IBAN went from one to the other" is an audit
    // entry; "a PATCH returned 200" is a web-server log.
    const { token } = await newEntity()
    const created = await handleCreateContact(
      await context(token, uuidv7()),
      createContactBody.parse({
        number: 'CRE-0002',
        name: 'Leverancier B.V.',
        isSupplier: true,
        iban: 'NL02ABNA012345678',
      }),
    )

    await handleUpdateContact(
      await context(token, uuidv7()),
      (created.body as { id: string }).id,
      updateContactBody.parse({ iban: 'NL02ABNA0123456789' }),
    )

    const [entry] = await log(token)
    expect(entry?.action).toBe('sales.updateContact')
    expect(entry?.before).toEqual({ iban: 'NL02ABNA012345678' })
    expect(entry?.after).toEqual({ iban: 'NL02ABNA0123456789' })
  })

  it('records a settings change as a diff of what was sent', async () => {
    const { token } = await newEntity()

    await handleUpdateEntity(
      await context(token, uuidv7()),
      updateEntityBody.parse({ vatRounding: 'per_line' }),
    )

    const [entry] = await log(token)
    expect(entry?.action).toBe('setup.updateEntity')
    expect(entry?.before).toEqual({ vatRounding: 'per_invoice' })
    expect(entry?.after).toEqual({ vatRounding: 'per_line' })
  })

  it('records the authorisation of a cost, and the state it came from', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )
    await handleTransitionPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      transitionPurchaseInvoiceBody.parse({ action: 'approve' }),
    )

    // `ledger.postJournalEntry` is in here too, written *inside* the posting
    // transaction rather than by `recordAudit`. That is the one row that has to
    // be atomic: an entry in the hash chain with no audit row is exactly what an
    // inspector is looking for.
    const recorded = await actions(token)
    expect(recorded).toEqual([
      'purchase.approve',
      'purchase.book',
      'ledger.postJournalEntry',
      'purchase.capture',
      'sales.createContact',
    ])

    const approval = (await log(token))[0]
    expect(approval?.before).toEqual({ status: 'booked' })
    expect(approval?.after).toMatchObject({ status: 'approved' })
  })

  it('records a payment batch being submitted and approved, in order', async () => {
    // The two-person control. "Approved" without "from submitted" does not show
    // the sequence, and the sequence is the control.
    const { entityId, token } = await newEntity()
    const account = await handleCreateBankAccount(
      await context(token, uuidv7()),
      createBankAccountBody.parse({
        iban: 'NL20INGB0001234567',
        name: 'Rekening-courant',
        ledgerAccountNumber: '1100',
      }),
    )

    const batch = await handleCreateBatch(
      await context(token, uuidv7()),
      createBatchBody.parse({
        reference: 'BETAAL-0001',
        bankAccountId: (account.body as { id: string }).id,
        requestedExecutionDate: '2026-05-01',
      }),
    )
    const batchId = (batch.body as { id: string }).id

    await handleCreateContact(
      await context(token, uuidv7()),
      createContactBody.parse({ number: 'CRE-0003', name: 'X', isSupplier: true }),
    )

    const { token: second } = await issueToken(database, {
      entityId,
      name: 'approver',
      permissions: ['*'],
      actorKind: 'human',
      actorId: `human-approver-${entityId.slice(0, 8)}`,
    })

    // A batch has to be payable to be submitted, so give it something to pay.
    const { handleAddInstruction } = await import('../src/api/handlers/payments.js')
    const { addInstructionBody } = await import('../src/api/schemas.js')
    await handleAddInstruction(
      await context(token, uuidv7()),
      batchId,
      addInstructionBody.parse({
        endToEndId: 'E2E-1',
        creditorName: 'Leverancier B.V.',
        creditorIban: 'NL02ABNA0123456789',
        amount: '4550',
        remittanceInformation: 'F-1',
      }),
    )

    await handleTransitionBatch(
      await context(token, uuidv7()),
      batchId,
      transitionBatchBody.parse({ action: 'submit' }),
    )
    await handleTransitionBatch(
      await context(second, uuidv7()),
      batchId,
      transitionBatchBody.parse({ action: 'approve' }),
    )

    const entries = await log(token)
    const approve = entries.find((entry) => entry.action === 'payments.approve')
    const submit = entries.find((entry) => entry.action === 'payments.submit')

    expect(submit?.before).toEqual({ state: 'draft' })
    expect(approve?.before).toEqual({ state: 'submitted' })
    expect(approve?.after).toMatchObject({ state: 'approved' })
    // Two different people, which is the whole point of the control.
    expect(approve?.actor.id).not.toBe(submit?.actor.id)
  })

  it('keeps the credential out of it when a mailbox is configured', async () => {
    const { token } = await newEntity()

    const { handleAddInboundSource } = await import('../src/api/handlers/inbound-sources.js')
    const { addInboundSourceBody } = await import('../src/api/schemas.js')
    await handleAddInboundSource(
      await context(token, uuidv7()),
      addInboundSourceBody.parse({
        kind: 'imap',
        name: 'Mailbox',
        host: 'imap.example.test',
        user: 'facturen@example.test',
        password: 'geheim',
      }),
    )

    const [entry] = await log(token)
    expect(entry?.action).toBe('inbox.addSource')
    expect(JSON.stringify(entry)).not.toContain('geheim')
  })
})

describe('reading it back', () => {
  it('is newest first, and filters by resource and action', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    await handleUpdateEntity(
      await context(token, uuidv7()),
      updateEntityBody.parse({ vatRounding: 'per_line' }),
    )

    expect((await actions(token))[0]).toBe('setup.updateEntity')

    const contacts = await handleListAuditLog(
      await context(token),
      auditLogQuery.parse({ resourceType: 'contact' }),
    )
    expect(contacts.body.entries.map((entry) => entry.action)).toEqual(['sales.createContact'])

    const byAction = await handleListAuditLog(
      await context(token),
      auditLogQuery.parse({ action: 'setup.updateEntity' }),
    )
    expect(byAction.body.entries).toHaveLength(1)
  })

  it('shows one administration nothing of another', async () => {
    const { token } = await newEntity()
    const other = await newEntity()
    await aSupplier(other.token)

    expect(await log(token)).toEqual([])
    expect(await log(other.token)).toHaveLength(1)
  })

  it('needs ledger:export, not ledger:read', async () => {
    // What the books say and what everybody did are different questions, and
    // the second one is an audit.
    const { entityId } = await newEntity()
    const { token: reader } = await issueToken(database, {
      entityId,
      name: 'reader',
      permissions: ['ledger:read'],
      actorKind: 'human',
      actorId: 'reader',
    })

    await expect(
      handleListAuditLog(await context(reader), auditLogQuery.parse({})),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

/**
 * RFC 4180, the subset this export produces: every cell quoted, a quote inside
 * one doubled. Written out rather than asserted against a substring, because
 * "the row still has eleven cells" is the property that actually matters.
 */
function parseCsvRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (inQuotes) {
      if (character !== '"') cell += character
      else if (line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else inQuotes = false
      continue
    }
    if (character === '"') inQuotes = true
    else if (character === ',') {
      cells.push(cell)
      cell = ''
    } else cell += character
  }

  cells.push(cell)
  return cells
}

describe('handing it over', () => {
  /** Drain the export stream, the way a download would. */
  async function download(token: string, format: 'jsonl' | 'csv') {
    const result = await handleExportAuditLog(
      await context(token),
      auditLogExportQuery.parse({ format }),
    )
    const text = await new Response(result.stream).text()
    return { text, filename: result.filename, contentType: result.contentType }
  }

  it('exports one JSON object per line, oldest first', async () => {
    // Oldest first because an export is read as a narrative.
    const { token } = await newEntity()
    await aSupplier(token)
    await handleUpdateEntity(
      await context(token, uuidv7()),
      updateEntityBody.parse({ vatRounding: 'per_line' }),
    )

    const { text, filename, contentType } = await download(token, 'jsonl')
    const lines = text.trimEnd().split('\n')

    expect(contentType).toBe('application/x-ndjson')
    expect(filename).toMatch(/^auditlog-.*\.jsonl$/)
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => (JSON.parse(line) as { action: string }).action)).toEqual([
      'sales.createContact',
      'setup.updateEntity',
    ])
  })

  it('exports CSV a spreadsheet can open, with quotes inside values escaped', async () => {
    const { token } = await newEntity()
    await handleUpdateEntity(
      await context(token, uuidv7()),
      updateEntityBody.parse({ name: 'Naam met "aanhalingstekens"' }),
    )

    const { text, contentType } = await download(token, 'csv')
    const [header, row] = text.trimEnd().split('\n')

    expect(contentType).toContain('text/csv')
    expect(header).toBe(
      'occurred_at,actor_kind,actor_id,actor_principal_id,action,resource_type,resource_id,before,after,request_id,ip',
    )

    // The assertion that matters: a quote inside a value must not end the row
    // early, so the row still has exactly as many cells as the header.
    const cells = parseCsvRow(row ?? '')
    expect(cells).toHaveLength(11)
    expect(cells[4]).toBe('setup.updateEntity')
    expect(JSON.parse(cells[8]!)).toEqual({ name: 'Naam met "aanhalingstekens"' })
  })

  it('exports only the period asked for', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    const past = await handleExportAuditLog(
      await context(token),
      auditLogExportQuery.parse({ from: '2020-01-01', until: '2020-12-31' }),
    )
    expect(await new Response(past.stream).text()).toBe('')

    const now = await download(token, 'jsonl')
    expect(now.text.trimEnd().split('\n')).toHaveLength(1)
  })

  it('walks past a page boundary without dropping or repeating a row', async () => {
    // The keyset cursor is a row-value comparison rather than a timestamp: two
    // rows can share a microsecond, and `>` would drop the second while `>=`
    // would repeat the first.
    const { entityId } = await newEntity()
    const { withAudit } = await import('@klopt/db')

    await withAudit(database, async (repository) => {
      for (let index = 0; index < 25; index += 1) {
        await repository.append({
          entityId,
          actor: { kind: 'script', id: 'seeder', principalId: null },
          action: 'test.tick',
          resourceType: 'test',
          resourceId: String(index),
          before: null,
          after: { index },
          requestId: null,
          ip: null,
        })
      }
    })

    const { withAuditRead } = await import('@klopt/db')
    const seen: string[] = []
    await withAuditRead(database, async (repository) => {
      // A batch size well under the row count, so the cursor has to work.
      for await (const row of repository.stream({ entityId, resourceType: 'test' }, 4)) {
        seen.push(row.resourceId)
      }
    })

    expect(seen).toHaveLength(25)
    expect(new Set(seen).size).toBe(25)
    expect(seen).toEqual(Array.from({ length: 25 }, (_, index) => String(index)))
  })
})
