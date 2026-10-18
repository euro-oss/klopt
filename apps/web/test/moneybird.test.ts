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
  it('stores the token encrypted and does not call Moneybird yet', async () => {
    const { token } = await newEntity()
    const moneybird = fakeMoneybird()
    await connect(token)
    expect(moneybird.asked).toEqual([])
    const body = (await handleGetMoneybirdConnection(await context(token))).body
    expect(body.connection).toMatchObject({ connected: true, ready: false, administrationId: null })
    expect(JSON.stringify(body)).not.toContain('mb-test-token')
  })

  it('refuses to store a token without an encryption key', async () => {
    const { token } = await newEntity()
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
})

describe('the dry run', () => {
  it('reconciles booked history and writes nothing', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    const preview = (await handlePreviewMoneybirdImport(await context(token))).body
    expect(preview.dryRun).toBe(true)
    expect(preview.problems).toEqual([])
    expect(preview.counts.salesInvoices).toBe(1)
    expect(preview.notImported).toContain('oauth')
    expect(preview.reconciliation[0]).toMatchObject({ source: 'read', balanced: true })
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
    )
    expect(outcome.state).toBe('done')

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
    )
    expect(again.state).toBe('idle')

    const replay = await handleRunMoneybirdImport(await context(token, crypto.randomUUID()))
    expect(replay.status).toBe(202)
    const second = await importMoneybirdAdministration(
      database,
      createFilesystemDocumentStore({ directory }),
    )
    expect(second.state).toBe('done')
    expect(await counts(entityId)).toEqual(first)
  })

  it('does not call an unreadable source reconciled on the commit report', async () => {
    const { token } = await newEntity()
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
    )
    expect(outcome.state).toBe('done')
    const status = (await handleMoneybirdImportStatus(await context(token))).body
    if (!status.requested || status.report === null || !status.report.imported) {
      throw new Error('expected a commit report')
    }
    expect(status.report.reconciliation.every((year) => year.source === 'unreadable')).toBe(true)
    expect(status.report.reconciliation.every((year) => year.balanced === null)).toBe(true)
    expect(status.report.reconciliation.every((year) => year.kloptDebit !== null)).toBe(true)
  })

  it('does not call an unreadable purchase source reconciled on the commit report', async () => {
    const { token } = await newEntity()
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
    )
    expect(outcome.state).toBe('done')
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
          moneybirdFxRateQuery.parse({ currency: 'USD', documentDate: '2026-03-15' }),
        ),
      ).rejects.toMatchObject({ code: 'conflict' })
    } finally {
      globalThis.fetch = previous
    }
  })

  it('refresh fx-rate records an audit entry after writing the cache', async () => {
    const { token } = await newEntity()
    fakeMoneybird()
    await connect(token)
    await choose(token)
    const moneybirdFetch = globalThis.fetch
    const ecbXml = `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time="2026-03-14"><Cube currency="USD" rate="1.0853"/></Cube></Cube></gesmes:Envelope>`
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
        moneybirdFxRateQuery.parse({ currency: 'USD', documentDate: '2026-03-15' }),
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
        currency: 'USD',
        documentDate: '2026-03-15',
        feed: 'full',
      })
      expect(Number((refresh?.after as { rows?: string }).rows ?? '0')).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = moneybirdFetch
    }
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
