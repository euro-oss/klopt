import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseXaf, uuidv7, validateXafDocument } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import {
  handleCloseYear,
  handleExportAuditFile,
  handleGetBalanceSheet,
  handleGetProfitAndLoss,
  handleGetRgsCoverage,
  handleImportAuditFile,
  handlePreviewRgsUpgrade,
  handleSetRgsMappings,
} from '../src/api/handlers/compliance.js'
import { handleGetVatReturn } from '../src/api/handlers/vat.js'
import { postJournalEntryBody } from '../src/api/schemas.js'

/**
 * M0's compliance surface, end to end against a real Postgres and the real
 * RGS 3.7 scheme: statements, mapping coverage, year close, and XAF export and
 * import.
 *
 * The export test validates its output with `xmllint` against the published
 * XSD, so this is not "we produced some XML" — it is "we produced an auditfile
 * the Belastingdienst's schema accepts", from data that went through the
 * posting API.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

const SCHEMA = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'reference-data',
  'xaf',
  'XmlAuditfileFinancieel3.2.xsd',
)

const hasXmllint = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

let database: Database

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/api/v1/x', { headers })
}

async function newEntity(
  permissions: readonly string[] = ['*'],
  options: { alsoFiscalYears?: readonly string[] } = {},
) {
  const entityId = await seedEntity(database, options)
  // The tax codes, so the trading year below can tag its VAT. Without them the
  // auditfile's `vatCodes` block is empty and every `vatID` on a line refers to
  // nothing — which is exactly how the export stayed invalid unnoticed.
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'test',
    permissions: [...permissions],
    actorKind: 'script',
    actorId: 'compliance-test',
  })
  return { entityId, token }
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

/** A year of trading: capital in, an invoice with BTW, a purchase, a payment. */
async function postTradingYear(token: string) {
  const entries = [
    {
      journalCode: 'MEM',
      bookingDate: '2026-01-02',
      documentDate: '2026-01-02',
      description: 'Storting aandelenkapitaal',
      lines: [
        { accountNumber: '1100', debit: '500000' },
        { accountNumber: '0500', credit: '500000' },
      ],
    },
    {
      journalCode: 'VRK',
      bookingDate: '2026-01-20',
      documentDate: '2026-01-20',
      description: 'Verkoopfactuur 2026-001',
      lines: [
        { accountNumber: '1300', debit: '1210000' },
        {
          accountNumber: '8000',
          credit: '1000000',
          taxCode: 'H21',
          taxRole: 'base',
          taxAmount: '210000',
        },
        {
          accountNumber: '1500',
          credit: '210000',
          taxCode: 'H21',
          taxRole: 'tax',
          taxAmount: '210000',
        },
      ],
    },
    {
      journalCode: 'INK',
      bookingDate: '2026-03-10',
      documentDate: '2026-03-08',
      // Deliberately untagged: this fixture's arithmetic is quoted in the
      // assertions below, and input VAT has its own tests in vat.test.ts.
      description: 'Inkoopfactuur Leverancier',
      lines: [
        { accountNumber: '4000', debit: '400000' },
        { accountNumber: '1600', credit: '400000' },
      ],
    },
    {
      journalCode: 'BNK',
      bookingDate: '2026-03-28',
      documentDate: '2026-03-28',
      description: 'Ontvangst factuur 2026-001',
      lines: [
        { accountNumber: '1100', debit: '600000' },
        { accountNumber: '1300', credit: '600000' },
      ],
    },
  ]

  for (const entry of entries) {
    await handlePostJournalEntry(await context(token, uuidv7()), postJournalEntryBody.parse(entry))
  }
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
}, 60_000)

afterAll(async () => {
  await closeDatabase(database)
})

describe('the statements', () => {
  it('balance sheet balances, and its result matches the P&L', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const query = { fiscalYear: '2026', fromPeriod: 1, toPeriod: 13, currency: 'EUR' }
    const sheet = await handleGetBalanceSheet(await context(token), query)
    const statement = await handleGetProfitAndLoss(await context(token), query)

    expect(sheet.body.difference).toBe('0')
    // 5000 capital + 12100 invoiced - 6000 collected + 6000 = 11000 bank,
    // 6100 debtors remaining.
    expect(sheet.body.totalAssets).toBe('1710000')
    expect(sheet.body.totalLiabilitiesAndEquity).toBe('1710000')

    expect(statement.body.revenue.total).toBe('1000000')
    expect(statement.body.expenses.total).toBe('400000')
    expect(statement.body.result).toBe('600000')
    // The number both statements have to agree on.
    expect(sheet.body.resultForPeriod).toBe(statement.body.result)
  })

  it('presents both sides positive and carries the RGS codes', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const sheet = await handleGetBalanceSheet(await context(token), {
      fiscalYear: '2026',
      fromPeriod: 1,
      toPeriod: 13,
      currency: 'EUR',
    })

    const creditors = sheet.body.liabilities.lines.find((line) => line.accountNumber === '1600')
    expect(creditors?.amount).toBe('400000')
    expect(creditors?.signedBalance).toBe('-400000')
    expect(creditors?.rgsCode).toBe('BSchCre')
  })

  it('restricts the P&L to the requested periods', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const march = await handleGetProfitAndLoss(await context(token), {
      fiscalYear: '2026',
      fromPeriod: 3,
      toPeriod: 3,
      currency: 'EUR',
    })

    // January's invoice is outside the range; March's purchase is not.
    expect(march.body.revenue.total).toBe('0')
    expect(march.body.expenses.total).toBe('400000')
    expect(march.body.result).toBe('-400000')
    expect(march.body.fromDate).toBe('2026-03-01')
    expect(march.body.toDate).toBe('2026-03-31')
  })
})

describe('RGS coverage', () => {
  it('reports what is mapped, weighted by balance', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const coverage = await handleGetRgsCoverage(await context(token), {
      currency: 'EUR',
      applicableFlag: 'BV',
    })

    expect(coverage.body.version).toBe('3.7')
    expect(coverage.body.accountCount).toBe(14)
    // Only 9999 is unmapped in the seeded chart, and it has no balance.
    expect(coverage.body.unmappedAccounts).toEqual(['9999'])
    expect(coverage.body.mappedPercentage).toBe(100)
    expect(coverage.body.unusedCodeCount).toBeGreaterThan(100)
  })

  it('reports mapping problems rather than hiding them', async () => {
    const { token } = await newEntity()
    const coverage = await handleGetRgsCoverage(await context(token), {
      currency: 'EUR',
      applicableFlag: null,
    })

    // 1300 Debiteuren is mapped to BVorDeb, a level-3 aggregate.
    const aggregate = coverage.body.problems.find(
      (problem) => problem.code === 'aggregate_code' && problem.accountNumber === '1300',
    )
    expect(aggregate?.severity).toBe('warning')
    expect(coverage.body.problems.some((problem) => problem.code === 'unmapped')).toBe(true)
  })
})

describe('setting RGS mappings', () => {
  it('applies a mapping and records who changed it', async () => {
    const { token } = await newEntity()

    const result = await handleSetRgsMappings(await context(token), {
      mappings: [{ accountNumber: '1300', rgsCode: 'BVorDebHad' }],
      dryRun: false,
    })

    expect(result.body.changed).toBe(1)

    const coverage = await handleGetRgsCoverage(await context(token), {
      currency: 'EUR',
      applicableFlag: null,
    })
    // The aggregate warning is gone now it maps to a level-4 code.
    expect(
      coverage.body.problems.some(
        (problem) => problem.code === 'aggregate_code' && problem.accountNumber === '1300',
      ),
    ).toBe(false)
  })

  it('refuses a code that is not in the loaded scheme, and changes nothing', async () => {
    const { token } = await newEntity()

    await expect(
      handleSetRgsMappings(await context(token), {
        mappings: [
          { accountNumber: '1300', rgsCode: 'BVorDebHad' },
          { accountNumber: '1100', rgsCode: 'NOTREAL' },
        ],
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    const coverage = await handleGetRgsCoverage(await context(token), {
      currency: 'EUR',
      applicableFlag: null,
    })
    // The valid half of the batch must not have been applied.
    expect(
      coverage.body.problems.some(
        (problem) => problem.code === 'aggregate_code' && problem.accountNumber === '1300',
      ),
    ).toBe(true)
  })

  it('refuses an account that does not exist', async () => {
    const { token } = await newEntity()
    await expect(
      handleSetRgsMappings(await context(token), {
        mappings: [{ accountNumber: '7777', rgsCode: 'BVorDebHad' }],
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('needs ledger:configure', async () => {
    const { token } = await newEntity(['ledger:read'])
    await expect(
      handleSetRgsMappings(await context(token), {
        mappings: [{ accountNumber: '1300', rgsCode: 'BVorDebHad' }],
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('the RGS upgrade preview', () => {
  it('refuses a version that is not loaded, and says what is', async () => {
    const { token } = await newEntity()
    await expect(
      handlePreviewRgsUpgrade(await context(token), { toVersion: '9.9' }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reports no impact when upgrading to the version already in use', async () => {
    const { token } = await newEntity()
    const preview = await handlePreviewRgsUpgrade(await context(token), { toVersion: '3.7-mkb' })

    expect(preview.body.summary.added).toBe(0)
    expect(preview.body.summary.removed).toBe(0)
    expect(preview.body.impacts).toEqual([])
    expect(preview.body.blocking).toBe(0)
  })
})

/** A close posts its opening balance into the following year. */
const closable = () => newEntity(['*'], { alsoFiscalYears: ['2027'] })

describe('year close', () => {
  const closeBody = {
    carryForward: true,
    fiscalYear: '2026',
    resultAccountNumber: '0500',
    journalCode: 'MEM',
    dryRun: false,
  }

  it('dry run shows the entries and commits nothing', async () => {
    const { token } = await closable()
    await postTradingYear(token)

    const preview = await handleCloseYear(await context(token, uuidv7()), {
      ...closeBody,
      dryRun: true,
    })

    expect(preview.body.dryRun).toBe(true)
    expect(preview.body.result).toBe('600000')
    expect(preview.body.appropriationLines).toHaveLength(3)

    // Nothing was posted, so the P&L is untouched.
    const statement = await handleGetProfitAndLoss(await context(token), {
      fiscalYear: '2026',
      fromPeriod: 1,
      toPeriod: 13,
      currency: 'EUR',
    })
    expect(statement.body.result).toBe('600000')
  })

  it('flattens the P&L and moves the result into equity', async () => {
    const { token } = await closable()
    await postTradingYear(token)

    const query = { fiscalYear: '2026', fromPeriod: 1, toPeriod: 13, currency: 'EUR' }
    const before = await handleGetBalanceSheet(await context(token), query)

    const close = await handleCloseYear(await context(token, uuidv7()), closeBody)
    expect(close.status).toBe(201)
    expect(close.body.appropriationEntryId).not.toBeNull()

    const statement = await handleGetProfitAndLoss(await context(token), query)
    const after = await handleGetBalanceSheet(await context(token), query)

    expect(statement.body.result).toBe('0')
    expect(after.body.resultForPeriod).toBe('0')
    expect(after.body.difference).toBe('0')
    expect(after.body.totalAssets).toBe(before.body.totalAssets)
    // 5000 capital + 6000 result.
    expect(after.body.equity.total).toBe('1100000')
  })

  it('refuses to close the same year twice', async () => {
    const { token } = await closable()
    await postTradingYear(token)

    await handleCloseYear(await context(token, uuidv7()), closeBody)
    await expect(handleCloseYear(await context(token, uuidv7()), closeBody)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('refuses to appropriate the result to something that is not equity', async () => {
    const { token } = await closable()
    await postTradingYear(token)

    await expect(
      handleCloseYear(await context(token, uuidv7()), {
        ...closeBody,
        resultAccountNumber: '1100',
      }),
    ).rejects.toMatchObject({ name: 'LedgerError' })
  })

  it('needs ledger:close', async () => {
    const { token } = await newEntity(['ledger:read', 'ledger:post'])
    await expect(handleCloseYear(await context(token, uuidv7()), closeBody)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('the XAF export', () => {
  it('produces an auditfile the published schema accepts', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const result = await handleExportAuditFile(await context(token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    expect(result.xml).toContain('<auditfile xmlns="http://www.auditfiles.nl/XAF/3.2">')
    expect(result.lineCount).toBe(9)

    if (hasXmllint) {
      const directory = mkdtempSync(join(tmpdir(), 'klopt-xaf-'))
      const path = join(directory, 'export.xml')
      writeFileSync(path, result.xml)
      // Throws, with the schema's own message, if the file is not valid.
      execFileSync('xmllint', ['--noout', '--schema', SCHEMA, path], { stdio: 'pipe' })
    }
  })

  it('declares the VAT codes its lines reference, and puts the tax on the base line', async () => {
    // The regression test for a bug that made the auditfile unexportable for
    // any entity that had ever posted an invoice: `vatCodes` was left empty
    // with a note saying the tax code engine was M3, so every `vatID` on a
    // line referred to nothing and the schema check refused the file. Nothing
    // noticed, because the fixture above used to post its "invoice with BTW"
    // without a tax code on it.
    const { token } = await newEntity()
    await postTradingYear(token)

    const result = await handleExportAuditFile(await context(token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    expect(result.xml).toContain('<vatID>H21</vatID>')
    expect(result.xml).toContain('<vatDesc>BTW hoog 21%</vatDesc>')
    expect(result.xml).toContain('<vatToPayAccID>1500</vatToPayAccID>')
    // The rate, from the code. It used to be hardcoded to zero.
    expect(result.xml).toContain('<vatPerc>21.00</vatPerc>')
    expect(result.xml).not.toContain('<vatPerc>0</vatPerc>')

    // XAF puts the `vat` block on the line whose `amnt` is the taxable base.
    // Two of them for one invoice declares the same tax twice.
    expect([...result.xml.matchAll(/<vatID>H21<\/vatID>/g)]).toHaveLength(2)

    // Every vatID a line references is declared.
    const declared = new Set(
      [...result.xml.matchAll(/<vatCode>\s*<vatID>([^<]+)<\/vatID>/g)].map((match) => match[1]),
    )
    const referenced = [...result.xml.matchAll(/<vat>\s*<vatID>([^<]+)<\/vatID>/g)].map(
      (match) => match[1],
    )
    expect(referenced.length).toBeGreaterThan(0)
    for (const code of referenced) expect(declared).toContain(code)
  })

  it('carries the RGS lead codes, which is the point of the exercise', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const result = await handleExportAuditFile(await context(token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    expect(result.xml).toContain('<leadCode>BVorDeb</leadCode>')
    expect(result.xml).toContain('<leadReference>1101000</leadReference>')
    expect(result.xml).toContain(
      '<leadDescription>Vorderingen op handelsdebiteuren</leadDescription>',
    )
    // 9999 has no mapping, so the file says so rather than pretending.
    expect(result.warnings.some((warning) => warning.message.includes('9999'))).toBe(true)
  })

  it('balances, and its control totals match its contents', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const result = await handleExportAuditFile(await context(token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    const validation = validateXafDocument(parseXaf(result.xml))
    expect(validation.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    expect(validation.totalDebit).toBe(validation.totalCredit)
    expect(validation.totalDebit).toBe(2_710_000n)
  })

  it('can be scoped to a period range', async () => {
    const { token } = await newEntity()
    await postTradingYear(token)

    const march = await handleExportAuditFile(await context(token), {
      fiscalYear: '2026',
      fromPeriod: 3,
      toPeriod: 3,
    })

    const document = parseXaf(march.xml)
    expect(document.header.startDate).toBe('2026-03-01')
    expect(document.header.endDate).toBe('2026-03-31')
    // January's entries are outside the range but their balances are not lost:
    // they arrive as the opening balance.
    expect(document.openingBalance).not.toBeNull()
    expect(document.journals.flatMap((journal) => journal.transactions)).toHaveLength(2)
  })

  it('needs ledger:export', async () => {
    const { token } = await newEntity(['ledger:read'])
    await expect(
      handleExportAuditFile(await context(token), {
        fiscalYear: '2026',
        fromPeriod: null,
        toPeriod: null,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('export then import: the round trip that makes the migration claim true', () => {
  it('a dry run reconciles against the exported file', async () => {
    const source = await newEntity()
    await postTradingYear(source.token)

    const exported = await handleExportAuditFile(await context(source.token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    const target = await newEntity()
    const plan = await handleImportAuditFile(await context(target.token, uuidv7()), {
      xml: exported.xml,
      dryRun: true,
    })

    expect(plan.body.dryRun).toBe(true)
    expect(plan.body.reconciliation.matches).toBe(true)
    expect(plan.body.reconciliation.actualTotalDebit).toBe('2710000')
    expect(plan.body.entryCount).toBe(4)
    // The target was seeded with the same chart, so nothing is new.
    expect(plan.body.accounts.new).toBe(0)
    expect(plan.body.journals.new).toBe(0)
    expect(plan.body.posted).toBe(0)
  })

  it('imports for real, and the two administrations agree', async () => {
    const source = await newEntity()
    await postTradingYear(source.token)

    const exported = await handleExportAuditFile(await context(source.token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    const target = await newEntity()
    const imported = await handleImportAuditFile(await context(target.token, uuidv7()), {
      xml: exported.xml,
      dryRun: false,
    })

    expect(imported.status).toBe(201)
    expect(imported.body.posted).toBe(4)

    const query = { fiscalYear: '2026', fromPeriod: 1, toPeriod: 13, currency: 'EUR' }
    const original = await handleGetBalanceSheet(await context(source.token), query)
    const copy = await handleGetBalanceSheet(await context(target.token), query)

    expect(copy.body.totalAssets).toBe(original.body.totalAssets)
    expect(copy.body.resultForPeriod).toBe(original.body.resultForPeriod)
    expect(copy.body.difference).toBe('0')
  })

  it('carries the VAT through, so the copy files the same aangifte', async () => {
    // The claim the whole importer rests on. Every imported line used to arrive
    // untagged, so a migrated year reconciled perfectly on the balance sheet
    // and declared nothing on the BTW-aangifte — discovered at the next filing,
    // when the file is long gone.
    const source = await newEntity()
    await postTradingYear(source.token)

    const exported = await handleExportAuditFile(await context(source.token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    const target = await newEntity()
    await handleImportAuditFile(await context(target.token, uuidv7()), {
      xml: exported.xml,
      dryRun: false,
    })

    const original = await handleGetVatReturn(await context(source.token), '2026-Q1')
    const copy = await handleGetVatReturn(await context(target.token), '2026-Q1')

    expect(copy.body.owed).toBe(original.body.owed)
    expect(copy.body.deductible).toBe(original.body.deductible)
    expect(copy.body.payable).toBe(original.body.payable)
    // And it is not zero, or the assertion above would pass on an empty return.
    expect(original.body.owed).not.toBe('0')
  })

  it('refuses a file whose tax codes the target does not have', async () => {
    // Not a warning: the entries would post, the trial balance would
    // reconcile, and the aangifte would quietly declare nothing.
    const source = await newEntity()
    await postTradingYear(source.token)

    const exported = await handleExportAuditFile(await context(source.token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })
    // A code the target cannot know: same file, unknown vatID.
    const foreign = exported.xml.replace(/H21/g, 'MWST19')

    const target = await newEntity()
    await expect(
      handleImportAuditFile(await context(target.token, uuidv7()), {
        xml: foreign,
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('refuses a file whose control totals lie', async () => {
    const source = await newEntity()
    await postTradingYear(source.token)

    const exported = await handleExportAuditFile(await context(source.token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })
    const tampered = exported.xml.replace(
      /<totalDebit>[\d.]+<\/totalDebit>/,
      '<totalDebit>1.00</totalDebit>',
    )

    const target = await newEntity()
    await expect(
      handleImportAuditFile(await context(target.token, uuidv7()), {
        xml: tampered,
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('refuses to post into an entity that lacks the accounts', async () => {
    const source = await newEntity()
    await postTradingYear(source.token)
    const exported = await handleExportAuditFile(await context(source.token), {
      fiscalYear: '2026',
      fromPeriod: null,
      toPeriod: null,
    })

    // A file from somewhere else, with an account this entity does not have.
    const foreign = exported.xml.replace(/1300/g, '1301')

    const target = await newEntity()
    await expect(
      handleImportAuditFile(await context(target.token, uuidv7()), {
        xml: foreign,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('needs an idempotency key, and needs ledger:import', async () => {
    const { token } = await newEntity()
    await expect(
      handleImportAuditFile(await context(token), { xml: '<auditfile/>', dryRun: true }),
    ).rejects.toMatchObject({ code: 'idempotency_key_required' })

    const readOnly = await newEntity(['ledger:read'])
    await expect(
      handleImportAuditFile(await context(readOnly.token, uuidv7()), {
        xml: '<auditfile/>',
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
