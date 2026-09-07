import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
  handleGetCreditorAgeing,
  handleGetPurchaseInvoice,
  handleListPurchaseInvoices,
  handleTransitionPurchaseInvoice,
} from '../src/api/handlers/purchase.js'
import { handleCreateContact } from '../src/api/handlers/sales.js'
import { handleGetVatReturn } from '../src/api/handlers/vat.js'
import { handleGetJournalEntry } from '../src/api/handlers/ledger.js'
import {
  bookPurchaseInvoiceBody,
  capturePurchaseInvoiceBody,
  createContactBody,
  creditorAgeingQuery,
  transitionPurchaseInvoiceBody,
} from '../src/api/schemas.js'

/**
 * Purchase invoices, end to end.
 *
 * The assertions that matter are the ones that reach past the invoice: that the
 * entry balances, that the deductible VAT is what rubriek 5b says, and that the
 * creditors subledger reconciles to its control account. An accounts-payable
 * module that gets its own list right and disagrees with the ledger is worse
 * than none.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity(permissions: string[] = ['*']) {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'purchase-test',
    permissions,
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

async function aSupplier(token: string, number = 'CRE-0001') {
  await handleCreateContact(
    await context(token, uuidv7()),
    createContactBody.parse({
      number,
      name: 'Leverancier B.V.',
      email: 'facturen@leverancier.test',
      vatNumber: 'NL987654321B01',
      isCustomer: false,
      isSupplier: true,
      iban: 'NL02ABNA0123456789',
      paymentTermsDays: 30,
    }),
  )
  return number
}

const capture = (overrides: Record<string, unknown> = {}) =>
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
    ...overrides,
  })

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
}, 60_000)

afterAll(async () => {
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('capturing an invoice', () => {
  it('records the supplier’s own figures and says nothing is wrong', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())

    expect(captured.status).toBe(201)
    expect(captured.body.findings).toEqual([])
    expect(captured.body.bookable).toBe(true)
    expect(captured.body.total).toBe('121000')

    const read = await handleGetPurchaseInvoice(await context(token), captured.body.id)
    expect(read.body.status).toBe('draft')
    expect(read.body.supplierInvoiceNumber).toBe('F-2026-0042')
    expect(read.body.net).toBe('100000')
    // Nothing posted yet.
    expect(read.body.journalEntryId).toBeNull()
    expect(read.body.payable).toBe(false)
    expect(read.body.payableRefusal).toContain('concept')
  })

  it('saves a capture with findings rather than refusing it', async () => {
    // A draft that cannot be saved is a draft somebody retypes. The refusal
    // belongs at booking, where it stops something irreversible.
    const { token } = await newEntity()
    await aSupplier(token)

    const captured = await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capture({
        tax: '19000',
        total: '119000',
        lines: [
          { description: 'x', accountNumber: '4000', taxCode: 'VH21', net: '100000', tax: '19000' },
        ],
      }),
    )

    expect(captured.status).toBe(201)
    expect(captured.body.findings.map((finding) => finding.code)).toContain('rate_mismatch')
    // A warning, so still bookable: the document is what it is.
    expect(captured.body.bookable).toBe(true)
  })

  it('refuses a second invoice with the same number from the same supplier', async () => {
    // Paying an invoice twice is the classic accounts-payable failure, and the
    // supplier's own numbering is the only thing that identifies a document
    // across two arrivals of it. Refused rather than saved-and-flagged: the
    // unique index will not hold two, and telling somebody "you already
    // entered this" is more use than a second copy to cancel.
    const { token } = await newEntity()
    await aSupplier(token)
    await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())

    await expect(
      handleCapturePurchaseInvoice(await context(token, uuidv7()), capture()),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('does not flag the same number from a different supplier', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    await aSupplier(token, 'CRE-0002')
    await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())

    const other = await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capture({ contactNumber: 'CRE-0002' }),
    )
    expect(other.body.findings).toEqual([])
  })

  it('refuses an unknown account or tax code before storing anything', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    await expect(
      handleCapturePurchaseInvoice(
        await context(token, uuidv7()),
        capture({
          lines: [
            {
              description: 'x',
              accountNumber: '9998',
              taxCode: 'VH21',
              net: '100000',
              tax: '21000',
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('needs ledger:post', async () => {
    const { token } = await newEntity(['ledger:read'])
    await expect(
      handleCapturePurchaseInvoice(await context(token, uuidv7()), capture()),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('booking an invoice', () => {
  it('posts a balanced entry at the invoice date and links it', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())

    const booked = await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    expect(booked.body.status).toBe('booked')
    expect(booked.body.journalEntryId).not.toBeNull()

    const { entry } = (
      await handleGetJournalEntry(await context(token), booked.body.journalEntryId)
    ).body
    // The invoice's own date, which is what decides the VAT period.
    expect(entry.bookingDate).toBe('2026-02-10')
    expect(entry.sourceDocumentRef).toBe('F-2026-0042')

    const debits = entry.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n)
    const credits = entry.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n)
    expect(debits).toBe(credits)
    expect(debits).toBe(121_000n)

    const creditor = entry.lines.find((line) => line.accountNumber === '1600')
    expect(creditor).toMatchObject({ credit: '121000', subledgerKind: 'supplier' })
  })

  it('refuses to book a capture that is not the document', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capture({
        net: '90000',
        total: '111000',
      }),
    )

    await expect(
      handleBookPurchaseInvoice(
        await context(token, uuidv7()),
        captured.body.id,
        bookPurchaseInvoiceBody.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'invoice_not_bookable' })
  })

  it('refuses to book the same invoice twice', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    await expect(
      handleBookPurchaseInvoice(
        await context(token, uuidv7()),
        captured.body.id,
        bookPurchaseInvoiceBody.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'wrong_invoice_state' })
  })

  it('takes a booking date override, for the invoice that arrives late', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())

    const booked = await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({ bookingDate: '2026-04-01' }),
    )

    const { entry } = (
      await handleGetJournalEntry(await context(token), booked.body.journalEntryId)
    ).body
    expect(entry.bookingDate).toBe('2026-04-01')
    // The document date stays the invoice's.
    expect(entry.documentDate).toBe('2026-02-10')
  })
})

describe('the approval flow', () => {
  async function booked(token: string) {
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )
    return captured.body.id
  }

  it('makes an invoice payable only once approved', async () => {
    const { token } = await newEntity()
    const id = await booked(token)

    const before = await handleGetPurchaseInvoice(await context(token), id)
    expect(before.body.payable).toBe(false)
    expect(before.body.payableRefusal).toContain('nog niet goedgekeurd')

    const approved = await handleTransitionPurchaseInvoice(
      await context(token, uuidv7()),
      id,
      transitionPurchaseInvoiceBody.parse({ action: 'approve' }),
    )
    expect(approved.body.status).toBe('approved')
    expect(approved.body.payable).toBe(true)

    const after = await handleGetPurchaseInvoice(await context(token), id)
    expect(after.body.approvedBy).not.toBeNull()
    expect(after.body.payableRefusal).toBeNull()
  })

  it('needs purchase:approve, which ledger:post does not carry', async () => {
    const { entityId } = await newEntity()
    const { token: poster } = await issueToken(database, {
      entityId,
      name: 'poster',
      // Everything a bookkeeper has, which is everything except the one
      // permission this test is about.
      permissions: ['ledger:read', 'ledger:post', 'ledger:configure', 'ledger:export'],
      actorKind: 'human',
      actorId: 'poster',
    })
    const id = await booked(poster)

    await expect(
      handleTransitionPurchaseInvoice(
        await context(poster, uuidv7()),
        id,
        transitionPurchaseInvoiceBody.parse({ action: 'approve' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses an approval by a script, even with the permission', async () => {
    const { entityId } = await newEntity()
    const { token: human } = await issueToken(database, {
      entityId,
      name: 'human',
      permissions: ['*'],
      actorKind: 'human',
      actorId: 'human',
    })
    const id = await booked(human)

    const { token: cron } = await issueToken(database, {
      entityId,
      name: 'cron',
      permissions: ['*'],
      actorKind: 'script',
      actorId: 'cron',
    })

    await expect(
      handleTransitionPurchaseInvoice(
        await context(cron, uuidv7()),
        id,
        transitionPurchaseInvoiceBody.parse({ action: 'approve' }),
      ),
    ).rejects.toMatchObject({ code: 'approval_by_script' })
  })

  it('disputes with a reason, and stays booked while disputed', async () => {
    const { token } = await newEntity()
    const id = await booked(token)

    await expect(
      handleTransitionPurchaseInvoice(
        await context(token, uuidv7()),
        id,
        transitionPurchaseInvoiceBody.parse({ action: 'dispute' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    const disputed = await handleTransitionPurchaseInvoice(
      await context(token, uuidv7()),
      id,
      transitionPurchaseInvoiceBody.parse({
        action: 'dispute',
        reason: 'Twee dozen minder geleverd dan gefactureerd.',
      }),
    )
    expect(disputed.body.status).toBe('disputed')
    expect(disputed.body.payable).toBe(false)

    const read = await handleGetPurchaseInvoice(await context(token), id)
    // Still in the books: the liability is real until settled or credited.
    expect(read.body.journalEntryId).not.toBeNull()
    expect(read.body.disputedReason).toContain('Twee dozen')
    expect(read.body.payableRefusal).toContain('geschil')
  })

  it('sends a resolved dispute back to booked, clearing the old approval', async () => {
    const { token } = await newEntity()
    const id = await booked(token)

    await handleTransitionPurchaseInvoice(
      await context(token, uuidv7()),
      id,
      transitionPurchaseInvoiceBody.parse({ action: 'approve' }),
    )
    await handleTransitionPurchaseInvoice(
      await context(token, uuidv7()),
      id,
      transitionPurchaseInvoiceBody.parse({ action: 'dispute', reason: 'Verkeerd tarief.' }),
    )
    const resolved = await handleTransitionPurchaseInvoice(
      await context(token, uuidv7()),
      id,
      transitionPurchaseInvoiceBody.parse({ action: 'resolve' }),
    )

    expect(resolved.body.status).toBe('booked')
    const read = await handleGetPurchaseInvoice(await context(token), id)
    // The authorisation given before the problem was known does not survive it.
    expect(read.body.approvedBy).toBeNull()
    expect(read.body.payable).toBe(false)
  })
})

describe('what it does to the ledger and the aangifte', () => {
  it('puts the deductible VAT in rubriek 5b', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const aangifte = await handleGetVatReturn(await context(token), '2026-Q1')
    expect(aangifte.body.deductible).toBe('21000')
    expect(aangifte.body.payable).toBe('-21000')
    expect(aangifte.body.blocked).toBe(false)
    expect(aangifte.body.findings).toEqual([])
  })

  it('reconciles the creditors subledger to its control account', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const ageing = await handleGetCreditorAgeing(
      await context(token),
      creditorAgeingQuery.parse({ asOf: '2026-04-01' }),
    )

    expect(ageing.body.reconciliation.subledger).toBe('121000')
    expect(ageing.body.reconciliation.controlAccount).toBe('121000')
    expect(ageing.body.reconciliation.reconciles).toBe(true)
  })

  it('buckets by how overdue an invoice is, not by how old it is', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    // Due 12 March. As of 1 April that is 20 days late; as of 1 June, 81.
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const early = await handleGetCreditorAgeing(
      await context(token),
      creditorAgeingQuery.parse({ asOf: '2026-04-01' }),
    )
    expect(early.body.buckets[0]?.upTo30).toBe('121000')
    expect(early.body.buckets[0]?.upTo90).toBe('0')

    const later = await handleGetCreditorAgeing(
      await context(token),
      creditorAgeingQuery.parse({ asOf: '2026-06-01' }),
    )
    expect(later.body.buckets[0]?.upTo90).toBe('121000')
    expect(later.body.buckets[0]?.upTo30).toBe('0')

    // And before the due date it is not overdue at all.
    const before = await handleGetCreditorAgeing(
      await context(token),
      creditorAgeingQuery.parse({ asOf: '2026-03-01' }),
    )
    expect(before.body.buckets[0]?.current).toBe('121000')
  })

  it('keeps a draft out of the ageing and out of the ledger', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())

    const ageing = await handleGetCreditorAgeing(
      await context(token),
      creditorAgeingQuery.parse({ asOf: '2026-04-01' }),
    )
    expect(ageing.body.total).toBe('0')
    expect(ageing.body.reconciliation.reconciles).toBe(true)
  })

  it('reverses everything for a credit note', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capture({ kind: 'credit_note', supplierInvoiceNumber: 'CN-2026-0007' }),
    )
    const booked = await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const { entry } = (
      await handleGetJournalEntry(await context(token), booked.body.journalEntryId)
    ).body
    const creditor = entry.lines.find((line) => line.accountNumber === '1600')
    expect(creditor?.debit).toBe('121000')

    // And it reduces the deduction rather than adding to it.
    const aangifte = await handleGetVatReturn(await context(token), '2026-Q1')
    expect(aangifte.body.deductible).toBe('-21000')
  })
})

describe('the list', () => {
  it('counts what is waiting for somebody', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    const first = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capture({ supplierInvoiceNumber: 'F-2026-0043' }),
    )
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      first.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const listed = await handleListPurchaseInvoices(await context(token), {})
    expect(listed.body.invoices).toHaveLength(2)
    expect(listed.body.drafts).toBe(1)
    expect(listed.body.awaitingApproval).toBe(1)
  })

  it('filters to what is still open, excluding drafts', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const captured = await handleCapturePurchaseInvoice(await context(token, uuidv7()), capture())
    await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capture({ supplierInvoiceNumber: 'F-2026-0044' }),
    )
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const open = await handleListPurchaseInvoices(await context(token), { openOnly: true })
    expect(open.body.invoices).toHaveLength(1)
    expect(open.body.invoices[0]?.outstanding).toBe('121000')
  })
})
