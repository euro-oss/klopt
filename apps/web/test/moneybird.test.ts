import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { ApiError } from '../src/api/errors.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleChooseMoneybirdAdministration,
  handleConnectMoneybird,
  handleDisconnectMoneybird,
  handleGetMoneybirdConnection,
  handleListMoneybirdAdministrations,
  handleMoneybirdFxRate,
  handleMoneybirdImportStatus,
  handlePreviewMoneybirdImport,
  handleRefreshMoneybirdFxRate,
  handleRunMoneybirdImport,
  handleSaveMoneybirdMappings,
} from '../src/api/handlers/moneybird.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import {
  auditLogQuery,
  chooseMoneybirdAdministrationBody,
  connectMoneybirdBody,
  moneybirdFxRateQuery,
  saveMoneybirdMappingsBody,
} from '../src/api/schemas.js'
import { withEcbRates } from '@klopt/db'
import { fakeMoneybird } from './support/moneybird.js'

/**
 * Connecting to Moneybird and previewing an import, against a real database
 * and a fake Moneybird (issue #32).
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
const realFetch = globalThis.fetch

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
    name: 'moneybird-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

async function connect(token: string) {
  await handleConnectMoneybird(
    await context(token, `connect-${crypto.randomUUID()}`),
    connectMoneybirdBody.parse({
      apiToken: 'mb-test-token',
      baseUrl: 'https://moneybird.com/api/v2',
    }),
  )
}

async function countRows(table: string, entityId: string): Promise<number> {
  const [row] = await database.execute<{ n: string }>(
    `select count(*)::text as n from klopt.${table} where entity_id = '${entityId}'`,
  )
  return Number(row?.n ?? 0)
}

async function counts(entityId: string) {
  return {
    journalEntries: await countRows('journal_entries', entityId),
    contacts: await countRows('contacts', entityId),
    documents: await countRows('documents', entityId),
    bankTransactions: await countRows('bank_transactions', entityId),
  }
}

const MAPPINGS = {
  accountMappings: {
    '1': '1100',
    '2': '1300',
    '3': '1500',
    '4': '1510',
    '5': '1600',
    '6': '4000',
    '7': '8000',
    '8': '0500',
  },
  taxMappings: { '21': 'H21', '22': 'VH21' },
}

async function choose(token: string, administrationId = '123456') {
  await handleChooseMoneybirdAdministration(
    await context(token, `choose-${crypto.randomUUID()}`),
    chooseMoneybirdAdministrationBody.parse({ administrationId }),
  )
}

beforeAll(async () => {
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  await runMigrations(DATABASE_URL)
  setDatabaseForTest(database)
})

afterEach(() => {
  globalThis.fetch = realFetch
})

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  await closeDatabase(database)
})

describe('connecting', () => {
  it('validates the token against Moneybird then stores it encrypted', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    await connect(token)
    expect(moneybird.asked.some((url) => url.includes('/administrations.json'))).toBe(true)
    const body = (await handleGetMoneybirdConnection(await context(token))).body
    expect(body.connection).toMatchObject({ connected: true, ready: false, administrationId: null })
    expect(JSON.stringify(body)).not.toContain('mb-test-token')
  })

  it('refuses an invalid Moneybird token without marking connected', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await expect(
      handleConnectMoneybird(
        await context(token, crypto.randomUUID()),
        connectMoneybirdBody.parse({
          apiToken: 'definitely-wrong-token',
          baseUrl: 'https://moneybird.com/api/v2',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      violations: [expect.objectContaining({ code: 'invalid_token', path: 'apiToken' })],
    })
    const body = (await handleGetMoneybirdConnection(await context(token))).body
    expect(body.connection).toBeNull()
  })

  it('refuses to store a token without an encryption key', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    const key = process.env['KLOPT_ENCRYPTION_KEY']
    delete process.env['KLOPT_ENCRYPTION_KEY']
    try {
      await expect(
        handleConnectMoneybird(
          await context(token, crypto.randomUUID()),
          connectMoneybirdBody.parse({ apiToken: 'mb-test-token' }),
        ),
      ).rejects.toBeInstanceOf(ApiError)
    } finally {
      process.env['KLOPT_ENCRYPTION_KEY'] = key
    }
  })
})

describe('choosing an administration', () => {
  it('records the name in the audit log', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    const listed = await handleListMoneybirdAdministrations(await context(token))
    expect(listed.body.administrations.map((row: { id: string }) => row.id).sort()).toEqual([
      '123456',
      '654321',
    ])

    await choose(token)
    const log = (
      await handleListAuditLog(await context(token), auditLogQuery.parse({}))
    ).body.entries.find(
      (row: { action: string }) => row.action === 'moneybird.chooseAdministration',
    )
    expect(log?.after).toMatchObject({ administrationName: 'Voorbeeld BV' })
  })

  it('refuses an administration the token cannot reach', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await expect(
      handleChooseMoneybirdAdministration(
        await context(token, crypto.randomUUID()),
        chooseMoneybirdAdministrationBody.parse({ administrationId: '999' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('clears Vorige keuze when switching to an administration with no saved mappings', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token, '123456')
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse({
        ...MAPPINGS,
        importDecisions: { excludedExternalIds: ['sales_invoice:99'] },
      }),
    )
    const before = (await handleGetMoneybirdConnection(await context(token))).body
    expect(before.connection?.taxMappings).toEqual(MAPPINGS.taxMappings)

    // 654321 has no 0037 row — connection maps from 123456 must not leak.
    await choose(token, '654321')
    const after = (await handleGetMoneybirdConnection(await context(token))).body
    expect(after.connection?.administrationId).toBe('654321')
    expect(after.connection?.taxMappings).toEqual({})
    expect(after.connection?.accountMappings).toEqual({})
    expect(after.connection?.importDecisions?.excludedExternalIds ?? []).toEqual([])
  })

  it('keeps mappings when re-picking the same administration with no 0037 row', async () => {
    const { entityId, token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token, '123456')
    // Pre-0037 / unsaved path: write onto the connection only (no mappings row).
    const { withMoneybirdConnection } = await import('@klopt/db')
    await withMoneybirdConnection(database, (repository) =>
      repository.saveMappings({
        entityId,
        accountMappings: MAPPINGS.accountMappings,
        taxMappings: MAPPINGS.taxMappings,
        importDecisions: { excludedExternalIds: ['sales_invoice:1', 'purchase_invoice:2'] },
      }),
    )
    const before = (await handleGetMoneybirdConnection(await context(token))).body
    expect(before.connection?.taxMappings).toEqual(MAPPINGS.taxMappings)
    expect(before.connection?.importDecisions?.excludedExternalIds).toEqual([
      'sales_invoice:1',
      'purchase_invoice:2',
    ])

    await choose(token, '123456')
    const after = (await handleGetMoneybirdConnection(await context(token))).body
    expect(after.connection?.administrationId).toBe('123456')
    expect(after.connection?.taxMappings).toEqual(MAPPINGS.taxMappings)
    expect(after.connection?.accountMappings).toEqual(MAPPINGS.accountMappings)
    expect(after.connection?.importDecisions?.excludedExternalIds).toEqual([
      'sales_invoice:1',
      'purchase_invoice:2',
    ])
  })
})

describe('the dry run', () => {
  it('reconciles booked history and writes nothing', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    // Confirmed mappings only — proposals never auto-fill (#105 PM).
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse(MAPPINGS),
    )
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.dryRun).toBe(true)
    expect(preview.problems).toEqual([])
    expect(preview.counts.salesInvoices).toBe(1)
    expect(preview.notImported).toContain('oauth')
    expect(preview.reconciliation[0]).toMatchObject({ source: 'read', balanced: true })
  })

  it('offers VGEEN for a null-% purchase and 0% sales codes without preselecting (#90)', async () => {
    const { token, entityId } = await newEntity()
    // seedSalesConfiguration is a short chart; add the 0% codes #90 maps onto.
    await database.execute(
      `insert into klopt.tax_codes (id, entity_id, code, description, rate_basis_points, direction, ubl_category, scope, reverse_charge, deductibility, valid_from)
       values
         (gen_random_uuid(), '${entityId}', 'VGEEN', 'Inkoop zonder btw', 0, 'input', 'O', 'out_of_scope', 'none', 'none', '2020-01-01'),
         (gen_random_uuid(), '${entityId}', 'GEEN', 'Vrijgesteld van btw', 0, 'output', 'E', 'exempt', 'none', 'full', '2020-01-01'),
         (gen_random_uuid(), '${entityId}', 'NUL', 'BTW 0% (export)', 0, 'output', 'G', 'export', 'none', 'full', '2020-01-01'),
         (gen_random_uuid(), '${entityId}', 'ICPD', 'ICP diensten 0%', 0, 'output', 'K', 'intra_community_supply', 'none', 'full', '2020-01-01')
       on conflict do nothing`,
    )
    const moneybird = fakeMoneybird()
    moneybird.taxRates = [
      {
        id: 90,
        name: 'Geen btw',
        percentage: null,
        tax_rate_type: 'purchase_invoice',
        country: 'NL',
        active: true,
      },
      {
        id: 91,
        name: 'Geen btw verkoop',
        percentage: null,
        tax_rate_type: 'sales_invoice',
        country: 'NL',
        active: true,
      },
    ]
    moneybird.purchaseInvoices = [
      {
        id: 401,
        contact_id: 200,
        reference: 'LEV-NULL',
        date: '2026-03-05',
        due_date: '2026-04-05',
        currency: 'EUR',
        state: 'open',
        total_price_excl_tax: '100.00',
        total_price_incl_tax: '100.00',
        total_tax: '0.00',
        details: [
          {
            id: 4011,
            description: 'Huur',
            amount: '1',
            price: '100.00',
            tax_rate_id: 90,
            ledger_account_id: 6,
          },
        ],
        attachments: [],
      },
    ]
    moneybird.salesInvoices = [
      {
        id: 301,
        contact_id: 100,
        invoice_id: '2026-NULL',
        state: 'open',
        invoice_date: '2026-03-01',
        due_date: '2026-03-31',
        currency: 'EUR',
        prices_are_incl_tax: false,
        total_price_excl_tax: '100.00',
        total_price_incl_tax: '100.00',
        total_tax: '0.00',
        details: [
          {
            id: 3011,
            description: 'Advies',
            amount: '1',
            price: '100.00',
            tax_rate_id: 91,
            ledger_account_id: 7,
          },
        ],
        attachments: [],
      },
    ]
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    const purchase = preview.taxRates.find((row) => row.moneybirdId === '90')
    const sales = preview.taxRates.find((row) => row.moneybirdId === '91')
    expect(purchase).toMatchObject({
      proposedCode: null,
      candidates: [{ code: 'VGEEN', group: 'other' }],
    })
    expect(sales?.proposedCode).toBeNull()
    expect(sales?.candidates.map((row) => row.code)).toEqual(
      expect.arrayContaining(['VERL', 'GEEN', 'NUL', 'ICP', 'ICPD']),
    )
    expect(sales?.candidates.some((row) => row.code === 'H21')).toBe(false)
    expect(preview.problems.map((problem) => problem.code)).toContain('unmapped_tax_rate')

    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse({
        accountMappings: MAPPINGS.accountMappings,
        taxMappings: { '90': 'VGEEN', '91': 'GEEN' },
      }),
    )
    const cleared = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(cleared.problems.filter((problem) => problem.code === 'unmapped_tax_rate')).toEqual([])
    expect(cleared.taxRates.find((row) => row.moneybirdId === '90')?.mappedCode).toBe('VGEEN')
  })

  it('blocks a null-% rate when the document still carries VAT (#90)', async () => {
    const { token, entityId } = await newEntity()
    await database.execute(
      `insert into klopt.tax_codes (id, entity_id, code, description, rate_basis_points, direction, ubl_category, scope, reverse_charge, deductibility, valid_from)
       values
         (gen_random_uuid(), '${entityId}', 'VGEEN', 'Inkoop zonder btw', 0, 'input', 'O', 'out_of_scope', 'none', 'none', '2020-01-01')
       on conflict do nothing`,
    )
    const moneybird = fakeMoneybird()
    moneybird.taxRates = [
      {
        id: 90,
        name: 'Geen btw',
        percentage: null,
        tax_rate_type: 'purchase_invoice',
        country: 'NL',
        active: true,
      },
    ]
    moneybird.purchaseInvoices = [
      {
        id: 401,
        contact_id: 200,
        reference: 'LEV-VAT',
        date: '2026-03-05',
        due_date: '2026-04-05',
        currency: 'EUR',
        state: 'open',
        total_price_excl_tax: '100.00',
        total_price_incl_tax: '121.00',
        total_tax: '21.00',
        details: [
          {
            id: 4011,
            description: 'Huur',
            amount: '1',
            price: '100.00',
            tax_rate_id: 90,
            ledger_account_id: 6,
          },
        ],
        attachments: [],
      },
    ]
    moneybird.salesInvoices = []
    moneybird.asked.length = 0
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.problems.map((problem) => problem.code)).toContain(
      'null_percentage_vat_mismatch',
    )
    const rate = preview.taxRates.find((row) => row.moneybirdId === '90')
    expect(rate?.candidates).toEqual([])
    expect(rate?.proposedCode).toBeNull()

    let caught: unknown
    try {
      await handleSaveMoneybirdMappings(
        await context(token, crypto.randomUUID()),
        saveMoneybirdMappingsBody.parse({
          accountMappings: MAPPINGS.accountMappings,
          taxMappings: { '90': 'VGEEN' },
        }),
      )
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('validation_failed')
  })

  it('refuses a foreign-currency administration', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.otherCurrency = true
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.problems.map((problem: { code: string }) => problem.code)).toContain(
      'unknown_currency',
    )
  })

  it('refuses a fiscal year that does not start with this entity', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.fiscalYearStartMonth = 4
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    const mismatch = preview.problems.find(
      (problem: { code: string }) => problem.code === 'fiscal_year_start_mismatch',
    )
    expect(mismatch).toBeDefined()
    expect(mismatch?.message).toContain('month 4')
    expect(mismatch?.message).toContain('month 1')
  })

  it('warns when Moneybird omits the year start', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.omitPeriodStart = true
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.problems.map((problem: { code: string }) => problem.code)).not.toContain(
      'fiscal_year_start_mismatch',
    )
    expect(preview.warnings.map((warning: { code: string }) => warning.code)).toContain(
      'fiscal_year_start_unknown',
    )
  })

  it('does not call an unreadable resource reconciled', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.forbidden.add('sales_invoices.json')
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.warnings.map((warning: { code: string }) => warning.code)).toContain(
      'resource_unreadable',
    )
    expect(
      preview.reconciliation.every(
        (year: { source: string; balanced: boolean | null }) =>
          year.source === 'unreadable' && year.balanced === null,
      ),
    ).toBe(true)
  })
})

describe('the import job', () => {
  it('queues work rather than posting in the request, and the worker posts through the ledger', async () => {
    const { entityId, token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse(MAPPINGS),
    )

    const queued = await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))
    expect(queued.status).toBe(202)
    expect(queued.body.state).toBe('pending')

    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const directory = mkdtempSync(join(tmpdir(), 'mb-docs-'))
    const outcome = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
      undefined,
      { entityId },
    )
    expect(outcome.state, outcome.failure ?? undefined).toBe('done')

    const status = (await handleMoneybirdImportStatus(await context(token))).body
    expect(status.requested).toBe(true)
    if (!status.requested) throw new Error('expected a Moneybird import run')
    expect(status.state).toBe('done')
    expect(status.report).toMatchObject({ imported: true, dryRun: false })
    if (status.report === null || !status.report.imported) {
      throw new Error('expected a commit report')
    }

    const year = status.report.reconciliation[0]
    expect(year).toMatchObject({ year: 2026, source: 'read', balanced: true })
    expect(year?.accounts.length).toBeGreaterThan(0)
    expect(year?.accounts.every((row) => /^-?\d+\.\d{2}$/.test(row.planned))).toBe(true)
    expect(year?.accounts.every((row) => /^-?\d+\.\d{2}$/.test(row.klopt))).toBe(true)
    expect(year?.differences).toEqual([])

    expect(status.report.opening).toMatchObject({ year: 2026 })
    // Opening-balance journal is booked separately — never a Klaar document (#105 PM).
    expect(status.report.openingEntriesPosted).toBe(1)
    expect(status.report.entriesPosted).toBeGreaterThan(0)
    const opening = Object.fromEntries(
      (status.report.opening?.accounts ?? []).map((row) => [row.accountNumber, row]),
    )
    expect(opening['1300']).toMatchObject({ planned: '1000.00', klopt: '1000.00' })
    expect(opening['0500']).toMatchObject({ planned: '-1000.00', klopt: '-1000.00' })
    expect(status.report.opening?.accounts.every((row) => row.difference === '0.00')).toBe(true)

    expect(status.report.attachmentsStored).toBeGreaterThan(0)
    const [purchase] = await database.execute<{ id: string; journal_entry_id: string | null }>(
      `select id, journal_entry_id from klopt.purchase_invoices where entity_id = '${entityId}'`,
    )
    expect(purchase).toBeDefined()
    expect(purchase!.journal_entry_id).toBeTruthy()
    const purchaseLinks = await database.execute<{
      document_id: string
      subject_kind: string
      subject_id: string
    }>(
      `select document_id, subject_kind, subject_id from klopt.document_links where entity_id = '${entityId}'`,
    )
    expect(
      purchaseLinks.some(
        (row) => row.subject_kind === 'purchase_invoice' && row.subject_id === purchase!.id,
      ),
    ).toBe(true)
    expect(
      purchaseLinks.some(
        (row) =>
          row.subject_kind === 'journal_entry' && row.subject_id === purchase!.journal_entry_id,
      ),
    ).toBe(true)

    const first = await counts(entityId)
    expect(first.journalEntries).toBeGreaterThan(0)
    expect(first.contacts).toBeGreaterThan(0)
    expect(first.documents).toBeGreaterThan(0)
    expect(first.bankTransactions).toBeGreaterThan(0)

    const again = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
      undefined,
      { entityId },
    )
    expect(again.state).toBe('idle')

    const replay = await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))
    expect(replay.status).toBe(202)
    const second = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
      undefined,
      { entityId },
    )
    expect(second.state).toBe('done')
    expect(await counts(entityId)).toEqual(first)

    // Re-preview after commit: entries exist → alreadyInKlopt for Legal count.
    const againPreview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(againPreview.alreadyInKlopt.count).toBeGreaterThan(0)
    const sample = againPreview.alreadyInKlopt.sample[0]
    expect(sample?.externalId).toMatch(
      /^(sales_invoice|purchase_invoice|journal|bank_mutation|credit_note|receipt):/,
    )
    expect(typeof sample?.reference).toBe('string')
  })

  it('does not call an unreadable source reconciled on the commit report', async () => {
    const { entityId, token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.forbidden.add('sales_invoices.json')
    await connect(token)
    await choose(token)
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse(MAPPINGS),
    )
    await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const directory = mkdtempSync(join(tmpdir(), 'mb-docs-'))
    const outcome = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
      undefined,
      { entityId },
    )
    expect(outcome.state, outcome.failure ?? undefined).toBe('done')
    const status = (await handleMoneybirdImportStatus(await context(token))).body
    if (!status.requested || status.report === null || !status.report.imported) {
      throw new Error('expected a commit report')
    }
    expect(status.report.reconciliation.every((year) => year.source === 'unreadable')).toBe(true)
    expect(status.report.reconciliation.every((year) => year.balanced === null)).toBe(true)
    expect(status.report.reconciliation.every((year) => year.kloptDebit !== null)).toBe(true)
  })

  it('does not call an unreadable purchase source reconciled on the commit report', async () => {
    const { entityId, token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.forbidden.add('documents/purchase_invoices.json')
    await connect(token)
    await choose(token)
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse(MAPPINGS),
    )
    await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const directory = mkdtempSync(join(tmpdir(), 'mb-docs-'))
    const outcome = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
      undefined,
      { entityId },
    )
    expect(outcome.state, outcome.failure ?? undefined).toBe('done')
    const status = (await handleMoneybirdImportStatus(await context(token))).body
    if (!status.requested || status.report === null || !status.report.imported) {
      throw new Error('expected a commit report')
    }
    expect(status.report.reconciliation.every((year) => year.source === 'unreadable')).toBe(true)
    expect(status.report.reconciliation.every((year) => year.balanced === null)).toBe(true)
  })

  it('refuses to start when the dry run has blocking problems', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    moneybird.otherCurrency = true
    await connect(token)
    await choose(token)
    await expect(
      handleRunMoneybirdImport(await context(token, crypto.randomUUID())),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('keeps commit counts on the failed report when attachments fail after booking', async () => {
    const { entityId, token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse(MAPPINGS),
    )
    await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))

    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    // Real store, then force attachment failure by pointing download URLs at a
    // dead host — commit still lands so the failed report keeps booked counts.
    const directory = mkdtempSync(join(tmpdir(), 'mb-partial-'))
    const store = createFilesystemDocumentStore({ directory })
    store.put = () => Promise.reject(new Error('attachment store failed after commit'))

    const outcome = await importMoneybirdAdministration(database, store, undefined, { entityId })
    expect(outcome.state, outcome.failure ?? undefined).toBe('failed')
    expect(outcome.failure).toMatch(/attachment store failed/)

    const status = (await handleMoneybirdImportStatus(await context(token))).body
    expect(status.requested).toBe(true)
    if (!status.requested) throw new Error('expected a Moneybird import run')
    expect(status.state).toBe('failed')
    // dryRun:false → imported:true with entriesPosted — UI chooses failedPartial.
    expect(status.report).toMatchObject({ imported: true, dryRun: false })
    if (status.report === null || !status.report.imported) {
      throw new Error('expected a booked commit report after post-commit failure')
    }
    expect(status.report.entriesPosted).toBeGreaterThan(0)
    expect(await countRows('journal_entries', entityId)).toBeGreaterThan(0)
  })

  it('treats a booked-report save failure in onCommitted as failedPartial', async () => {
    const { entityId, token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse(MAPPINGS),
    )
    await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))

    const { MoneybirdImportRepository } = await import('@klopt/db')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- prototype stub
    const originalFinish = MoneybirdImportRepository.prototype.finish
    let blockedRunningSave = false
    MoneybirdImportRepository.prototype.finish = async function finishOverride(
      this: InstanceType<typeof MoneybirdImportRepository>,
      request: Parameters<typeof originalFinish>[0],
    ) {
      if (!blockedRunningSave && request.state === 'running') {
        blockedRunningSave = true
        throw new Error('report save failed after commit')
      }
      return originalFinish.call(this, request)
    }

    try {
      const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
      const { createFilesystemDocumentStore } = await import('@klopt/adapters')
      const directory = mkdtempSync(join(tmpdir(), 'mb-report-save-'))
      const store = createFilesystemDocumentStore({ directory })
      const outcome = await importMoneybirdAdministration(database, store, undefined, { entityId })
      expect(outcome.state, outcome.failure ?? undefined).toBe('failed')
      expect(outcome.failure).toMatch(/report save failed/)

      const status = (await handleMoneybirdImportStatus(await context(token))).body
      expect(status.requested).toBe(true)
      if (!status.requested) throw new Error('expected a Moneybird import run')
      expect(status.state).toBe('failed')
      expect(status.report).toMatchObject({ imported: true, dryRun: false })
      if (status.report === null || !status.report.imported) {
        throw new Error('expected booked counts after onCommitted report-save failure')
      }
      expect(status.report.entriesPosted).toBeGreaterThan(0)
      expect(await countRows('journal_entries', entityId)).toBeGreaterThan(0)
    } finally {
      MoneybirdImportRepository.prototype.finish = originalFinish
    }
  })
})

describe('FX rate and mapping decisions', () => {
  it('GET fx-rate is cache-only and returns not_found without a seed', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    // Rare ISO code so a prior suite seed of USD/EUR cannot satisfy the lookup.
    await expect(
      handleMoneybirdFxRate(
        await context(token),
        moneybirdFxRateQuery.parse({ currency: 'XTS', documentDate: '2026-03-15' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('GET fx-rate returns a seeded cache row without fetching', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    const ctx = await context(token)
    await withEcbRates(ctx.database, (repository) =>
      repository.upsertMany([{ currency: 'USD', rateDate: '2026-03-14', rate: '0.9214' }]),
    )
    const body = (
      await handleMoneybirdFxRate(
        ctx,
        moneybirdFxRateQuery.parse({ currency: 'USD', documentDate: '2026-03-15' }),
      )
    ).body
    expect(body.source).toBe('ecb')
    expect(body.date).toBe('2026-03-14')
    expect(Number(body.rate)).toBeCloseTo(0.9214, 6)
  })

  it('refresh fx-rate surfaces a conflict when ECB fetch fails', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    const previous = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('ECB unreachable')
    }
    try {
      await expect(
        handleRefreshMoneybirdFxRate(
          await context(token),
          // Unique code so a prior suite seed cannot cache-hit.
          moneybirdFxRateQuery.parse({ currency: 'XPD', documentDate: '2026-03-15' }),
        ),
      ).rejects.toMatchObject({ code: 'conflict' })
    } finally {
      globalThis.fetch = previous
    }
  })

  it('refresh fx-rate maps an ECB abort/timeout to conflict rather than 5xx', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    const moneybirdFetch = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.includes('ecb.europa.eu')) {
        return moneybirdFetch(input, init)
      }
      // Production fetch uses AbortSignal.timeout(15_000); simulate that abort.
      void init?.signal
      return Promise.reject(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      )
    }
    try {
      await expect(
        handleRefreshMoneybirdFxRate(
          await context(token),
          moneybirdFxRateQuery.parse({ currency: 'XPT', documentDate: '2026-03-15' }),
        ),
      ).rejects.toMatchObject({ code: 'conflict' })
    } finally {
      globalThis.fetch = moneybirdFetch
    }
  })

  it('refresh fx-rate uses the cache without calling ECB when a qualifying row exists', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    const ctx = await context(token)
    await withEcbRates(ctx.database, (repository) =>
      repository.upsertMany([{ currency: 'XAU', rateDate: '2026-03-14', rate: '0.5' }]),
    )
    let ecbCalls = 0
    const moneybirdFetch = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('ecb.europa.eu')) {
        ecbCalls += 1
        return Promise.resolve(new Response('nope', { status: 500 }))
      }
      return moneybirdFetch(input, init)
    }
    try {
      const body = (
        await handleRefreshMoneybirdFxRate(
          ctx,
          moneybirdFxRateQuery.parse({ currency: 'XAU', documentDate: '2026-03-15' }),
        )
      ).body
      expect(Number(body.rate)).toBeCloseTo(0.5, 6)
      expect(ecbCalls).toBe(0)
    } finally {
      globalThis.fetch = moneybirdFetch
    }
  })

  it('refresh fx-rate records an audit entry after writing the cache', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    // Fresh ISO code each run so a prior cache row cannot short-circuit the fetch.
    const letters = crypto
      .randomUUID()
      .replace(/[^a-f]/gi, '')
      .slice(0, 2)
      .toUpperCase()
    const currency = `Q${letters}`
    const moneybirdFetch = globalThis.fetch
    const ecbXml = `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-03-14"><Cube currency="${currency}" rate="1.0853"/></Cube></Cube></gesmes:Envelope>`
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('ecb.europa.eu')) {
        return Promise.resolve(
          new Response(ecbXml, { status: 200, headers: { 'content-type': 'text/xml' } }),
        )
      }
      return moneybirdFetch(input, init)
    }
    try {
      await handleRefreshMoneybirdFxRate(
        await context(token),
        moneybirdFxRateQuery.parse({ currency, documentDate: '2026-03-15' }),
      )
      const audit = (
        await handleListAuditLog(
          await context(token),
          auditLogQuery.parse({ resourceType: 'moneybird_connection' }),
        )
      ).body
      const refresh = audit.entries.find(
        (row: { action: string }) => row.action === 'moneybird.refreshFxRate',
      )
      expect(refresh?.after).toMatchObject({
        currency,
        documentDate: '2026-03-15',
        feed: 'full',
      })
      expect(Number((refresh?.after as { rows?: string }).rows ?? '0')).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = moneybirdFetch
    }
  })

  it('rejects incompatible VAT mappings on save with 422 and persists nothing', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)

    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse(MAPPINGS),
    )
    const before = (await handleGetMoneybirdConnection(await context(token))).body
    expect(before.connection?.taxMappings).toEqual(MAPPINGS.taxMappings)
    expect(before.connection?.accountMappings).toEqual(MAPPINGS.accountMappings)

    let caught: unknown
    try {
      await handleSaveMoneybirdMappings(
        await context(token, crypto.randomUUID()),
        saveMoneybirdMappingsBody.parse({
          accountMappings: { '1': '9999' },
          taxMappings: { '21': 'VH21', '22': 'VH21' },
        }),
      )
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    const error = caught as ApiError
    expect(error.code).toBe('validation_failed')
    expect(error.status).toBe(422)
    expect(error.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'incompatible_tax_rate',
          path: 'taxRates.21',
          messageKey: 'moneybird.incompatible_tax_rate',
        }),
      ]),
    )
    expect(error.violations.every((row) => row.path !== 'taxRates.22')).toBe(true)

    const after = (await handleGetMoneybirdConnection(await context(token))).body
    expect(after.connection?.taxMappings).toEqual(MAPPINGS.taxMappings)
    expect(after.connection?.accountMappings).toEqual(MAPPINGS.accountMappings)
  })

  it('rejects a bad override rate at save and records audit fields for a good one', async () => {
    const { token, entityId } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)

    // Schema rejects non-positive rates before the handler runs.
    expect(() =>
      saveMoneybirdMappingsBody.parse({
        accountMappings: MAPPINGS.accountMappings,
        taxMappings: MAPPINGS.taxMappings,
        importDecisions: {
          exchangeRates: {
            'sales_invoice:301': { rate: '0', source: 'override', date: '2026-03-01' },
          },
        },
      }),
    ).toThrow(/positive number/)

    // Handler defense-in-depth: same check if a bad rate slips past the schema.
    const badBody: Parameters<typeof handleSaveMoneybirdMappings>[1] = {
      accountMappings: MAPPINGS.accountMappings,
      taxMappings: MAPPINGS.taxMappings,
      importDecisions: {
        exchangeRates: {
          'sales_invoice:301': { rate: '0', source: 'override', date: '2026-03-01' },
        },
      },
    }
    await expect(
      handleSaveMoneybirdMappings(await context(token, crypto.randomUUID()), badBody),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    await handleSaveMoneybirdMappings(
      await context(token, crypto.randomUUID()),
      saveMoneybirdMappingsBody.parse({
        accountMappings: MAPPINGS.accountMappings,
        taxMappings: MAPPINGS.taxMappings,
        importDecisions: {
          exchangeRates: {
            'sales_invoice:301': { rate: '0,9214', source: 'override', date: '2026-03-01' },
          },
          excludedExternalIds: ['sales_invoice:999'],
          acknowledgedEmptyYears: ['2025'],
        },
      }),
    )

    const audit = (
      await handleListAuditLog(
        await context(token),
        auditLogQuery.parse({ resourceType: 'moneybird_connection' }),
      )
    ).body
    const save = audit.entries.find(
      (row: { action: string }) => row.action === 'moneybird.saveMappings',
    )
    expect(save?.after).toMatchObject({
      'fx.sales_invoice:301.rate': '0.9214',
      'fx.sales_invoice:301.source': 'override',
      'fx.sales_invoice:301.date': '2026-03-01',
      excludedExternalIds: 'sales_invoice:999',
      acknowledgedEmptyYears: '2025',
    })
    expect(entityId).toBeTruthy()
  })
})

describe('disconnecting', () => {
  it('forgets the connection', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await handleDisconnectMoneybird(await context(token, crypto.randomUUID()))
    const body = (await handleGetMoneybirdConnection(await context(token))).body
    expect(body.connection).toBeNull()
  })
})
