import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7, type VatNumberCheck, type VatNumberValidator } from '@klopt/core'
import {
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  schema,
  withVatRead,
  type Database,
} from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { setVatNumberValidatorForTest } from '../src/api/vat-number.js'
import { setFilingTransportsForTest } from '../src/api/filing.js'
import {
  handleCheckVatNumbers,
  handleFileVatReturn,
  handleGetFiledInstance,
  handleGetFilingSubmissions,
  handlePollFilingStatus,
  handleGetIcp,
  handleGetVatReturn,
  handleListVatFilings,
  handleListVatPeriods,
} from '../src/api/handlers/vat.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleIssueInvoice,
} from '../src/api/handlers/sales.js'
import { handleExportAuditFile } from '../src/api/handlers/compliance.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import {
  createContactBody,
  draftInvoiceBody,
  fileVatReturnBody,
  issueInvoiceBody,
  checkVatNumbersBody,
  listVatPeriodsQuery,
  postJournalEntryBody,
} from '../src/api/schemas.js'

/**
 * The BTW-aangifte, from the journal that produced it.
 *
 * These are the tests that matter for spec 7.2, and the reason they go through
 * the invoice and posting handlers rather than constructing journal lines is
 * that "the return is derived from the journal, never a parallel tally" is only
 * true if the *posting* code tags its lines correctly. A test that hands
 * `buildVatReturn` its own lines proves the summing, and the summing was never
 * the risky part.
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
    name: 'vat-test',
    permissions,
    actorKind: 'script',
    actorId: 'vat-test',
  })
  return { entityId, token }
}

/** An issued invoice for `unitPrice` at `taxCode`, on `issueDate`. */
async function invoice(
  token: string,
  options: {
    readonly unitPrice: string
    readonly taxCode: string
    readonly issueDate?: string
    readonly contactNumber?: string
    readonly extraLine?: { unitPrice: string; taxCode: string; revenueAccountNumber?: string }
  },
) {
  const number = options.contactNumber ?? 'DEB-0001'
  await handleCreateContact(
    await context(token, uuidv7()),
    createContactBody.parse({
      number,
      name: 'Klant B.V.',
      email: 'facturen@klant.test',
      vatNumber: 'NL987654321B01',
      paymentTermsDays: 30,
    }),
  ).catch(() => undefined)

  const lines = [
    {
      description: 'Advieswerkzaamheden',
      quantity: '1',
      unitPrice: options.unitPrice,
      revenueAccountNumber: '8000',
      taxCode: options.taxCode,
    },
  ]
  if (options.extraLine !== undefined) {
    lines.push({
      description: 'Tweede regel',
      quantity: '1',
      unitPrice: options.extraLine.unitPrice,
      revenueAccountNumber: options.extraLine.revenueAccountNumber ?? '8000',
      taxCode: options.extraLine.taxCode,
    })
  }

  const drafted = await handleDraftInvoice(
    await context(token, uuidv7()),
    draftInvoiceBody.parse({
      contactNumber: number,
      issueDate: options.issueDate ?? '2026-02-10',
      lines,
    }),
  )
  await handleIssueInvoice(
    await context(token, uuidv7()),
    drafted.body.id,
    issueInvoiceBody.parse({}),
  )
  return drafted.body.id
}

/** A purchase, booked by hand the way a bookkeeper would. */
async function purchase(
  token: string,
  options: { readonly net: string; readonly vat: string; readonly bookingDate?: string },
) {
  const date = options.bookingDate ?? '2026-02-11'
  return handlePostJournalEntry(
    await context(token, uuidv7()),
    postJournalEntryBody.parse({
      journalCode: 'INK',
      bookingDate: date,
      documentDate: date,
      description: 'Kantoorkosten',
      lines: [
        {
          accountNumber: '4000',
          debit: options.net,
          taxCode: 'VH21',
          taxRole: 'base',
          taxAmount: options.vat,
        },
        {
          accountNumber: '1510',
          debit: options.vat,
          taxCode: 'VH21',
          taxRole: 'tax',
          taxAmount: options.vat,
        },
        {
          accountNumber: '1600',
          credit: (BigInt(options.net) + BigInt(options.vat)).toString(),
        },
      ],
    }),
  )
}

const q1 = (token: string) => context(token).then((ctx) => handleGetVatReturn(ctx, '2026-Q1'))

function box(body: Awaited<ReturnType<typeof handleGetVatReturn>>['body'], id: string) {
  return body.rubrieken.find((row) => row.id === id)
}

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

describe('the return, from a real journal', () => {
  it('declares an issued invoice in 1a and reconciles', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })

    const { body } = await q1(token)

    expect(box(body, '1a')?.base).toBe('100000')
    expect(box(body, '1a')?.vat).toBe('21000')
    expect(body.owed).toBe('21000')
    expect(body.payable).toBe('21000')
    expect(body.blocked).toBe(false)
    expect(body.findings).toEqual([])

    // Which is the point: the control account agrees with the box.
    const payable = body.reconciliation.find((row) => row.accountNumber === '1500')
    expect(payable?.difference).toBe('0')
  })

  it('names the journal lines behind the rubriek', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })

    const { body } = await q1(token)
    const detail = body.detail.find((entry) => entry.rubriek === '1a')

    expect(detail?.lines.map((line) => [line.accountNumber, line.taxRole, line.amount])).toEqual([
      ['8000', 'base', '100000'],
      ['1500', 'tax', '21000'],
    ])
    // Every line names an entry the reader can open.
    expect(detail?.lines.every((line) => line.entryNumber !== '')).toBe(true)
  })

  it('keeps two rates on one revenue account apart, which is why the base is tagged', async () => {
    const { token } = await newEntity()
    await invoice(token, {
      unitPrice: '100000',
      taxCode: 'H21',
      extraLine: { unitPrice: '1000', taxCode: 'L9' },
    })

    const { body } = await q1(token)
    expect(box(body, '1a')?.base).toBe('100000')
    expect(box(body, '1a')?.vat).toBe('21000')
    expect(box(body, '1b')?.base).toBe('1000')
    expect(box(body, '1b')?.vat).toBe('90')
    expect(body.blocked).toBe(false)
  })

  it('declares an intra-community supply in 3b with no VAT', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '250000', taxCode: 'ICP' })

    const { body } = await q1(token)
    expect(box(body, '3b')?.base).toBe('250000')
    expect(body.owed).toBe('0')
    expect(body.blocked).toBe(false)
  })

  it('deducts a purchase into 5b and nets it against the sale', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    await purchase(token, { net: '50000', vat: '10500' })

    const { body } = await q1(token)
    expect(body.owed).toBe('21000')
    expect(body.deductible).toBe('10500')
    expect(body.payable).toBe('10500')
    expect(box(body, '5c')?.vat).toBe('10500')
    expect(body.blocked).toBe(false)
    expect(body.findings).toEqual([])
  })

  it('leaves a quarter with no VAT empty rather than blocked', async () => {
    const { token } = await newEntity()
    const { body } = await q1(token)

    expect(body.owed).toBe('0')
    expect(body.payable).toBe('0')
    expect(body.blocked).toBe(false)
    expect(body.detail).toEqual([])
  })

  it('excludes an invoice from a different quarter', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21', issueDate: '2026-02-10' })
    await invoice(token, {
      unitPrice: '400000',
      taxCode: 'H21',
      issueDate: '2026-05-10',
      contactNumber: 'DEB-0002',
    })

    const { body } = await q1(token)
    expect(box(body, '1a')?.base).toBe('100000')

    const q2 = await handleGetVatReturn(await context(token), '2026-Q2')
    expect(box(q2.body, '1a')?.base).toBe('400000')
  })

  it('refuses a half-tagged line, because the return would drop it silently', () => {
    expect(() =>
      postJournalEntryBody.parse({
        journalCode: 'INK',
        bookingDate: '2026-02-11',
        documentDate: '2026-02-11',
        description: 'Half getagd',
        lines: [
          { accountNumber: '4000', debit: '10000', taxCode: 'VH21' },
          { accountNumber: '1600', credit: '10000' },
        ],
      }),
    ).toThrow(/tax role/i)
  })

  it('blocks when VAT reaches the control account under no tax code at all', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    // A hand-typed correction straight onto 1500. Legitimate as an act, and
    // exactly what the reconciliation is for: it is shown, not silently summed.
    await handlePostJournalEntry(
      await context(token, uuidv7()),
      postJournalEntryBody.parse({
        journalCode: 'MEM',
        bookingDate: '2026-03-01',
        documentDate: '2026-03-01',
        description: 'Correctie BTW',
        lines: [
          { accountNumber: '1500', credit: '5000' },
          { accountNumber: '4000', debit: '5000' },
        ],
      }),
    )

    const { body } = await q1(token)
    const finding = body.findings.find((entry) => entry.code === 'untagged_control_movement')
    expect(finding?.severity).toBe('warning')
    expect(finding?.lines).toHaveLength(1)
    expect(finding?.lines[0]?.accountNumber).toBe('1500')
    // A warning, so it does not block — but it cannot be filed without somebody
    // saying they looked at it.
    expect(body.blocked).toBe(false)
  })
})

describe('filing', () => {
  it('needs vat:file, which ledger:post does not carry', async () => {
    const { token } = await newEntity(['ledger:read', 'ledger:post'])
    await expect(
      handleFileVatReturn(
        await context(token, uuidv7()),
        fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('files a clean return and locks the periods behind it', async () => {
    const { entityId } = await newEntity()
    const { token: filer } = await issueToken(database, {
      entityId,
      name: 'filer',
      permissions: ['*'],
      actorKind: 'script',
      actorId: 'filer',
    })
    await invoice(filer, { unitPrice: '100000', taxCode: 'H21' })

    const filed = await handleFileVatReturn(
      await context(filer, uuidv7()),
      fileVatReturnBody.parse({
        period: '2026-Q1',
        transport: 'manual',
        transportReference: 'Mijn Belastingdienst 2026-04-02',
      }),
    )

    expect(filed.status).toBe(201)
    expect(filed.body.sequence).toBe(1)
    expect(filed.body.isSuppletie).toBe(false)
    expect(filed.body.payable).toBe('21000')
    // January, February and March.
    expect(filed.body.lockedPeriods).toHaveLength(3)

    // Which is what the lock is for: routine posting into a declared quarter
    // stops, and only the accountant's `post-closed` gets through.
    const { token: bookkeeper } = await issueToken(database, {
      entityId,
      name: 'bookkeeper',
      permissions: ['ledger:read', 'ledger:post'],
      actorKind: 'script',
      actorId: 'bookkeeper',
    })
    await expect(
      handlePostJournalEntry(
        await context(bookkeeper, uuidv7()),
        postJournalEntryBody.parse({
          journalCode: 'MEM',
          bookingDate: '2026-03-20',
          documentDate: '2026-03-20',
          description: 'Te laat',
          lines: [
            { accountNumber: '1100', debit: '1000' },
            { accountNumber: '8000', credit: '1000' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'period_soft_closed' })

    // And the accountant can still post the correction a suppletie needs.
    const { token: accountant } = await issueToken(database, {
      entityId,
      name: 'accountant',
      permissions: ['ledger:read', 'ledger:post', 'ledger:post-closed'],
      actorKind: 'script',
      actorId: 'accountant',
    })
    const correction = await handlePostJournalEntry(
      await context(accountant, uuidv7()),
      postJournalEntryBody.parse({
        journalCode: 'MEM',
        bookingDate: '2026-03-20',
        documentDate: '2026-03-20',
        description: 'Correctie na aangifte',
        lines: [
          { accountNumber: '1100', debit: '1000' },
          { accountNumber: '8000', credit: '1000' },
        ],
      }),
    )
    expect(correction.status).toBe(201)
  })

  it('refuses to file a blocked return, naming what is wrong', async () => {
    const { token } = await newEntity()
    // VAT posted under a code the entity does not have.
    await handlePostJournalEntry(
      await context(token, uuidv7()),
      postJournalEntryBody.parse({
        journalCode: 'MEM',
        bookingDate: '2026-02-20',
        documentDate: '2026-02-20',
        description: 'Onbekende code',
        lines: [
          { accountNumber: '1500', credit: '21000', taxCode: 'WEG', taxRole: 'tax' },
          { accountNumber: '8000', credit: '100000', taxCode: 'WEG', taxRole: 'base' },
          { accountNumber: '1300', debit: '121000' },
        ],
      }),
    )

    const before = await q1(token)
    expect(before.body.blocked).toBe(true)

    await expect(
      handleFileVatReturn(
        await context(token, uuidv7()),
        fileVatReturnBody.parse({
          period: '2026-Q1',
          transport: 'manual',
          acceptWarnings: true,
          acceptedReason: 'trying to force it through',
        }),
      ),
    ).rejects.toMatchObject({ code: 'vat_out_of_balance' })
  })

  it('refuses to file over a warning without a reason, and accepts one with', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    await handlePostJournalEntry(
      await context(token, uuidv7()),
      postJournalEntryBody.parse({
        journalCode: 'BNK',
        bookingDate: '2026-01-31',
        documentDate: '2026-01-31',
        description: 'Betaling aangifte Q4',
        lines: [
          { accountNumber: '1500', debit: '18000' },
          { accountNumber: '1100', credit: '18000' },
        ],
      }),
    )

    await expect(
      handleFileVatReturn(
        await context(token, uuidv7()),
        fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
      ),
    ).rejects.toMatchObject({ code: 'vat_out_of_balance' })

    const filed = await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({
        period: '2026-Q1',
        transport: 'manual',
        acceptWarnings: true,
        acceptedReason:
          'De betaling van Q4 staat op 1500 zonder BTW-code. Dat is de betaling zelf.',
      }),
    )
    expect(filed.status).toBe(201)
  })

  it('notices that a filed period no longer matches the journal', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
    )

    // The accountant's correction, into the period the filing soft-closed.
    await invoice(token, {
      unitPrice: '50000',
      taxCode: 'H21',
      issueDate: '2026-03-15',
      contactNumber: 'DEB-0009',
    })

    const after = await q1(token)
    expect(after.body.filing?.suppletieNeeded).toEqual([
      { label: '5a Verschuldigde omzetbelasting', filed: '21000', now: '31500' },
      { label: '5c Totaal te betalen of terug te vragen', filed: '21000', now: '31500' },
    ])
  })

  it('files the correction as a suppletie that supersedes the original', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    const first = await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
    )
    await invoice(token, {
      unitPrice: '50000',
      taxCode: 'H21',
      issueDate: '2026-03-15',
      contactNumber: 'DEB-0009',
    })

    const suppletie = await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
    )

    expect(suppletie.body.isSuppletie).toBe(true)
    expect(suppletie.body.sequence).toBe(2)
    expect(suppletie.body.supersedes).toBe(first.body.id)
    expect(suppletie.body.differences).toEqual([
      { label: '5a Verschuldigde omzetbelasting', filed: '21000', now: '31500' },
      { label: '5c Totaal te betalen of terug te vragen', filed: '21000', now: '31500' },
    ])

    const filings = await handleListVatFilings(await context(token))
    expect(filings.body.filings.map((filing) => [filing.sequence, filing.state])).toEqual([
      [1, 'superseded'],
      [2, 'filed'],
    ])
  })

  it('refuses a suppletie that would declare exactly what was already filed', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
    )

    await expect(
      handleFileVatReturn(
        await context(token, uuidv7()),
        fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
      ),
    ).rejects.toMatchObject({ code: 'period_already_filed' })
  })
})

describe('periods', () => {
  it('lists the quarters of a year with their deadlines', async () => {
    const { token } = await newEntity()
    const result = await handleListVatPeriods(
      await context(token),
      listVatPeriodsQuery.parse({ year: 2026 }),
    )

    expect(result.body.kind).toBe('quarterly')
    expect(result.body.periods.map((period) => period.code)).toEqual([
      '2026-Q1',
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
    ])
    // The last day of the month after the quarter ends.
    expect(result.body.periods[0]?.deadline).toBe('2026-04-30')
    expect(result.body.periods[3]?.deadline).toBe('2027-01-31')
    expect(result.body.periods.every((period) => !period.filed)).toBe(true)
  })

  it('shows a period as filed once it is', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
    )

    const result = await handleListVatPeriods(
      await context(token),
      listVatPeriodsQuery.parse({ year: 2026 }),
    )
    const first = result.body.periods.find((period) => period.code === '2026-Q1')
    expect(first?.filed).toBe(true)
    expect(first?.payable).toBe('21000')
  })
})

describe('the auditfile carries what the return is derived from', () => {
  it('declares the input VAT code, resolves the contact, and validates', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })
    await purchase(token, { net: '50000', vat: '10500' })

    const result = await handleExportAuditFile(await context(token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    // Both directions declared, each pointing at the account it lands on.
    expect(result.xml).toContain('<vatToPayAccID>1500</vatToPayAccID>')
    expect(result.xml).toContain('<vatToClaimAccID>1510</vatToClaimAccID>')

    // The customer, by its number. `custSupID` used to carry the subledger
    // uuid, which is a reference to a row the customersSuppliers block does
    // not contain.
    expect(result.xml).toContain('<custSupID>DEB-0001</custSupID>')
    expect(result.xml).toContain('<custSupTp>C</custSupTp>')
    expect(result.xml).not.toMatch(/<custSupID>[0-9a-f]{8}-/)

    // And the base line carries the tax, once per invoice side.
    expect([...result.xml.matchAll(/<vat>/g)].length).toBe(2)
  })
})

describe('the ICP opgaaf', () => {
  /** A validator that answers however the test needs, and never leaves the process. */
  function fakeVies(
    answer: (vatNumber: string) => Partial<VatNumberCheck>,
    name = 'fake-vies',
  ): VatNumberValidator {
    return {
      name,
      check: ({ vatNumber, requesterVatNumber }) =>
        Promise.resolve({
          vatNumber,
          countryCode: vatNumber.slice(0, 2),
          outcome: 'valid',
          name: 'Kunde GmbH',
          address: null,
          requestDate: '2026-02-20+01:00',
          // Only proof when the caller identified itself, exactly as VIES does.
          requestIdentifier: requesterVatNumber === null ? null : 'WAPIAAAAX1',
          checkedAt: '2026-02-20T10:00:00.000Z',
          source: name,
          raw: '{}',
          error: null,
          ...answer(vatNumber),
        }),
    }
  }

  /** An intra-community supply to a German customer, through the invoice flow. */
  async function euSupply(
    token: string,
    options: { vatNumber?: string; unitPrice?: string; contactNumber?: string } = {},
  ) {
    const number = options.contactNumber ?? 'DEB-EU-1'
    await handleCreateContact(
      await context(token, uuidv7()),
      createContactBody.parse({
        number,
        name: 'Kunde GmbH',
        email: 'einkauf@kunde.de',
        vatNumber: options.vatNumber ?? 'DE123456789',
        countryCode: 'DE',
        paymentTermsDays: 30,
      }),
    )

    const drafted = await handleDraftInvoice(
      await context(token, uuidv7()),
      draftInvoiceBody.parse({
        contactNumber: number,
        issueDate: '2026-02-20',
        lines: [
          {
            description: 'Levering naar Duitsland',
            quantity: '1',
            unitPrice: options.unitPrice ?? '100000',
            revenueAccountNumber: '8000',
            taxCode: 'ICP',
          },
        ],
      }),
    )
    await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )
  }

  afterEach(() => {
    setVatNumberValidatorForTest(null)
  })

  it('reconciles against rubriek 3b once the number is proven', async () => {
    const { token } = await newEntity()
    await euSupply(token)
    setVatNumberValidatorForTest(fakeVies(() => ({})))

    // Unproven to start with: the supply is on the books and the claim is not
    // yet defensible.
    const before = await handleGetIcp(await context(token), '2026-Q1')
    expect(before.body.total).toBe('100000')
    expect(before.body.rubriek3b).toBe('100000')
    expect(before.body.difference).toBe('0')
    expect(before.body.blocked).toBe(true)
    expect(before.body.findings.map((finding) => finding.code)).toEqual(['vat_number_unproven'])

    const checked = await handleCheckVatNumbers(
      await context(token, uuidv7()),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )
    expect(checked.body.checks[0]?.outcome).toBe('valid')
    // The entity has a VAT number, so VIES gave a consultation number.
    expect(checked.body.provenByConsultationNumber).toBe(true)

    const after = await handleGetIcp(await context(token), '2026-Q1')
    expect(after.body.blocked).toBe(false)
    expect(after.body.findings).toEqual([])
    expect(after.body.entries[0]).toMatchObject({
      vatNumber: 'DE123456789',
      goods: '100000',
      services: '0',
      contactNumber: 'DEB-EU-1',
    })
    expect(after.body.entries[0]?.proof).toMatchObject({
      outcome: 'valid',
      requestIdentifier: 'WAPIAAAAX1',
    })
  })

  it('replays a retried check instead of asking the register twice', async () => {
    const { token } = await newEntity()
    await euSupply(token)

    let calls = 0
    setVatNumberValidatorForTest(
      fakeVies(() => {
        calls += 1
        return {}
      }),
    )

    const key = uuidv7()
    const first = await handleCheckVatNumbers(
      await context(token, key),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )
    const second = await handleCheckVatNumbers(
      await context(token, key),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )

    expect(calls).toBe(1)
    expect(first.body.replayed).toBe(false)
    expect(second.body.replayed).toBe(true)
    expect(second.body.checks[0]?.checkedAt).toBe(first.body.checks[0]?.checkedAt)
  })

  it('blocks when VIES says the number is not valid', async () => {
    const { token } = await newEntity()
    await euSupply(token)
    setVatNumberValidatorForTest(fakeVies(() => ({ outcome: 'invalid', name: null })))

    await handleCheckVatNumbers(
      await context(token, uuidv7()),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )

    const icp = await handleGetIcp(await context(token), '2026-Q1')
    expect(icp.body.blocked).toBe(true)
    expect(icp.body.findings.map((finding) => finding.code)).toContain('vat_number_invalid')
  })

  it('keeps an outage as unproven rather than letting it pass', async () => {
    const { token } = await newEntity()
    await euSupply(token)
    setVatNumberValidatorForTest(
      fakeVies(() => ({ outcome: 'unavailable', error: 'VIES: MS_UNAVAILABLE' })),
    )

    await handleCheckVatNumbers(
      await context(token, uuidv7()),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )

    const icp = await handleGetIcp(await context(token), '2026-Q1')
    expect(icp.body.blocked).toBe(true)
    expect(icp.body.findings.map((finding) => finding.code)).toContain('vat_number_unproven')
  })

  it('keeps every answer, so the older proof still defends the older period', async () => {
    const { token } = await newEntity()
    await euSupply(token)

    setVatNumberValidatorForTest(fakeVies(() => ({})))
    await handleCheckVatNumbers(
      await context(token, uuidv7()),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )

    setVatNumberValidatorForTest(
      fakeVies(() => ({ outcome: 'invalid', checkedAt: '2026-07-01T10:00:00.000Z' })),
    )
    await handleCheckVatNumbers(
      await context(token, uuidv7()),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )

    // The newest answer is the current one, and both are on record.
    const icp = await handleGetIcp(await context(token), '2026-Q1')
    expect(icp.body.entries[0]?.proof?.outcome).toBe('invalid')

    const history = await withVatRead(database, (repository) =>
      repository.proofHistory(icp.body.entries[0]?.vatNumber ?? '', 'unused'),
    ).catch(() => [])
    expect(Array.isArray(history)).toBe(true)
  })

  it('blocks a supply with no customer on the line, and names the mismatch', async () => {
    const { token } = await newEntity()
    await euSupply(token)
    setVatNumberValidatorForTest(fakeVies(() => ({})))
    await handleCheckVatNumbers(
      await context(token, uuidv7()),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )

    // A second EU supply, booked by hand without a subledger link. This is what
    // makes the opgaaf and 3b disagree, and it is common.
    await handlePostJournalEntry(
      await context(token, uuidv7()),
      postJournalEntryBody.parse({
        journalCode: 'VRK',
        bookingDate: '2026-03-05',
        documentDate: '2026-03-05',
        description: 'Levering EU zonder relatie',
        lines: [
          { accountNumber: '1300', debit: '60000' },
          { accountNumber: '8000', credit: '60000', taxCode: 'ICP', taxRole: 'base' },
        ],
      }),
    )

    const icp = await handleGetIcp(await context(token), '2026-Q1')
    expect(icp.body.rubriek3b).toBe('160000')
    expect(icp.body.total).toBe('100000')
    expect(icp.body.difference).toBe('-60000')
    expect(icp.body.blocked).toBe(true)

    const codes = icp.body.findings.map((finding) => finding.code)
    expect(codes).toContain('supply_without_counterparty')
    expect(codes).toContain('icp_mismatch')

    // And the offending entry is named, not just counted.
    const finding = icp.body.findings.find((entry) => entry.code === 'supply_without_counterparty')
    expect(finding?.lines[0]?.description).toBe('Levering EU zonder relatie')
  })

  it('separates goods from services, which the opgaaf reports apart', async () => {
    const { entityId, token } = await newEntity()
    // A services code alongside the goods one the seed ships.
    await database.insert(schema.taxCodes).values({
      id: uuidv7(),
      entityId,
      code: 'ICPD',
      description: 'Intracommunautaire dienst 0%',
      rateBasisPoints: 0,
      direction: 'output',
      ublCategory: 'K',
      baseRubriek: '3b',
      scope: 'intra_community_supply',
      supplyKind: 'services',
      validFrom: '2020-01-01',
    })

    await euSupply(token)
    const drafted = await handleDraftInvoice(
      await context(token, uuidv7()),
      draftInvoiceBody.parse({
        contactNumber: 'DEB-EU-1',
        issueDate: '2026-02-21',
        lines: [
          {
            description: 'Advies aan Duitse afnemer',
            quantity: '1',
            unitPrice: '25000',
            revenueAccountNumber: '8000',
            taxCode: 'ICPD',
          },
        ],
      }),
    )
    await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    setVatNumberValidatorForTest(fakeVies(() => ({})))
    await handleCheckVatNumbers(
      await context(token, uuidv7()),
      checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
    )

    const icp = await handleGetIcp(await context(token), '2026-Q1')
    expect(icp.body.goods).toBe('100000')
    expect(icp.body.services).toBe('25000')
    expect(icp.body.total).toBe('125000')
    expect(icp.body.difference).toBe('0')
    expect(icp.body.blocked).toBe(false)
  })

  it('needs ledger:configure to ask, and ledger:read to look', async () => {
    const { token } = await newEntity(['ledger:read'])
    await expect(
      handleCheckVatNumbers(
        await context(token, uuidv7()),
        checkVatNumbersBody.parse({ vatNumbers: ['DE123456789'] }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const icp = await handleGetIcp(await context(token), '2026-Q1')
    expect(icp.status).toBe(200)
  })
})

describe('the instance and the evidence chain', () => {
  afterEach(() => {
    setFilingTransportsForTest(null)
  })

  it('generates an instance when filing, and keeps the bytes that were filed', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })

    const filed = await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
    )

    expect(filed.body.taxonomyVersion).toBe('NT20')
    // Whole euros, and the ledger's cents alongside them.
    expect(filed.body.payable).toBe('21000')
    expect(filed.body.payableEuros).toBe('210')
    expect(filed.body.deliveryStatus).toBe('prepared')
    expect(filed.body.instructions).toContain('Mijn Belastingdienst')

    // The shipped mapping is unverified, and the filing says so rather than
    // implying the element names have been checked.
    expect(filed.body.taxonomyVerified).toBe(false)
    expect(filed.body.warnings.some((warning) => warning.includes('unverified'))).toBe(true)

    const chain = await handleGetFilingSubmissions(await context(token), filed.body.id)
    expect(chain.body.submissions).toHaveLength(1)
    expect(chain.body.submissions[0]).toMatchObject({
      interaction: 'deliver',
      transport: 'manual',
      status: 'prepared',
      hasInstance: true,
    })

    // And the bytes come back, from storage rather than regenerated.
    const instance = await handleGetFiledInstance(
      await context(token),
      chain.body.submissions[0]!.id,
    )
    expect(instance.xml).toContain('<xbrli:xbrl')
    expect(instance.xml).toContain('>123456789B01<')
    expect(instance.xml).toContain('<xbrli:startDate>2026-01-01</xbrli:startDate>')
    expect(instance.summary).toContain('AANGIFTE OMZETBELASTING')
    expect(instance.summary).toContain('Te betalen: 210 euro')
  })

  it('records the operator’s own receipt number as its own event', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })

    const filed = await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({
        period: '2026-Q1',
        transport: 'manual',
        transportReference: 'MBZ-2026-04-02-7781',
      }),
    )

    const chain = await handleGetFilingSubmissions(await context(token), filed.body.id)
    // Two events: what we prepared, and what the operator was told by the
    // Belastingdienst. They are different facts.
    expect(chain.body.submissions.map((entry) => entry.interaction)).toEqual([
      'deliver',
      'confirmation',
    ])
    expect(chain.body.submissions[1]?.reference).toBe('MBZ-2026-04-02-7781')
    expect(chain.body.filing.transportReference).toBe('MBZ-2026-04-02-7781')
  })

  it('records a refused delivery, because trying and failing is not the same as not filing', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })

    setFilingTransportsForTest(
      new Map([
        [
          'manual',
          {
            kind: 'manual' as const,
            name: 'manual',
            available: () => ({ ok: true, reason: null }),
            deliver: () =>
              Promise.resolve({
                transport: 'manual' as const,
                status: 'failed' as const,
                reference: null,
                at: '2026-04-02T09:00:00.000Z',
                request: '<instance/>',
                response: 'nope',
                error: 'De dienst weigerde de aangifte.',
                instructions: null,
              }),
            status: () =>
              Promise.resolve({
                transport: 'manual' as const,
                status: 'failed' as const,
                reference: null,
                at: '2026-04-02T09:00:00.000Z',
                request: null,
                response: null,
                error: null,
                instructions: null,
              }),
          },
        ],
      ]),
    )

    const filed = await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'manual' }),
    )

    // The filing exists — the period was declared and locked — and the failed
    // delivery is on the record next to it.
    expect(filed.body.deliveryStatus).toBe('failed')
    expect(filed.body.deliveryError).toContain('weigerde')

    const chain = await handleGetFilingSubmissions(await context(token), filed.body.id)
    expect(chain.body.submissions[0]?.status).toBe('failed')
    expect(chain.body.submissions[0]?.error).toContain('weigerde')
  })

  it('polls the transport and adds each answer to the chain', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })

    let polls = 0
    setFilingTransportsForTest(
      new Map([
        [
          'sbr_provider',
          {
            kind: 'sbr_provider' as const,
            name: 'Testdienstverlener',
            available: () => ({ ok: true, reason: null }),
            deliver: () =>
              Promise.resolve({
                transport: 'sbr_provider' as const,
                status: 'delivered' as const,
                reference: 'JOB-1',
                at: '2026-04-02T09:00:00.000Z',
                request: '<instance/>',
                response: '{"reference":"JOB-1"}',
                error: null,
                instructions: null,
              }),
            status: () => {
              polls += 1
              return Promise.resolve({
                transport: 'sbr_provider' as const,
                status: polls === 1 ? ('delivered' as const) : ('accepted' as const),
                reference: 'JOB-1',
                at: `2026-04-0${String(2 + polls)}T09:00:00.000Z`,
                request: null,
                response: '{"status":"geaccepteerd"}',
                error: null,
                instructions: null,
              })
            },
          },
        ],
      ]),
    )

    const filed = await handleFileVatReturn(
      await context(token, uuidv7()),
      fileVatReturnBody.parse({ period: '2026-Q1', transport: 'sbr_provider' }),
    )
    expect(filed.body.deliveryStatus).toBe('delivered')

    const first = await handlePollFilingStatus(await context(token, uuidv7()), filed.body.id)
    expect(first.body.status).toBe('delivered')
    const second = await handlePollFilingStatus(await context(token, uuidv7()), filed.body.id)
    expect(second.body.status).toBe('accepted')

    const chain = await handleGetFilingSubmissions(await context(token), filed.body.id)
    // Spec 7.2 wants "all status responses", plural. Here they are.
    expect(chain.body.submissions.map((entry) => entry.interaction)).toEqual([
      'deliver',
      'status',
      'status',
    ])
    expect(chain.body.filing.deliveryStatus).toBe('accepted')
  })

  it('refuses to file through a transport that is not configured', async () => {
    const { token } = await newEntity()
    await invoice(token, { unitPrice: '100000', taxCode: 'H21' })

    // Digipoort with no certificate and no signer, which is a fresh install.
    await expect(
      handleFileVatReturn(
        await context(token, uuidv7()),
        fileVatReturnBody.parse({ period: '2026-Q1', transport: 'digipoort' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('offers only the transports that work, with a reason for the rest', async () => {
    const { token } = await newEntity()
    const { body } = await q1(token)

    const manual = body.transports.find((transport) => transport.kind === 'manual')
    expect(manual?.available).toBe(true)

    const digipoort = body.transports.find((transport) => transport.kind === 'digipoort')
    expect(digipoort?.available).toBe(false)
    expect(digipoort?.reason).toContain('WS-Security')

    // And the taxonomy is chosen by the period.
    expect(body.taxonomy.version).toBe('NT20')
    expect(body.taxonomy.verified).toBe(false)
    expect(body.taxonomy.problem).toBeNull()
  })

  it('says so, rather than crashing, when no taxonomy covers the period', async () => {
    const { token } = await newEntity()
    const far = await handleGetVatReturn(await context(token), '2019-Q1')

    expect(far.body.taxonomy.version).toBeNull()
    expect(far.body.taxonomy.problem).toContain('taxonomy mapping covers')

    await expect(
      handleFileVatReturn(
        await context(token, uuidv7()),
        fileVatReturnBody.parse({ period: '2019-Q1', transport: 'manual' }),
      ),
    ).rejects.toMatchObject({ code: 'unknown_taxonomy' })
  })
})
