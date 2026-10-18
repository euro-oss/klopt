/**
 * Demo administration seeder (issue #48).
 *
 * Runs the operator command's library entry point against a real database and
 * asserts every acceptance criterion the issue lists.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadSchematronFromDirectory,
  REQUIRED_PEPPOL_SCHEMATRON_FILES,
  validateAgainst,
} from '@klopt/adapters'
import {
  buildTrialBalance,
  checkUblRules,
  generateUbl,
  parseVatPeriodCode,
  suggestMatches,
  toUblDocument,
  verifyHashChain,
} from '@klopt/core'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, type Database } from '../src/client.js'
import {
  assertDemoDatasetIsFictional,
  assertFictionalDataset,
  DEMO_BUYER_REFERENCE_PREFIX,
  DEMO_ENTITY_ID,
  DEMO_ENTITY_NAME,
  DEMO_FISCAL_YEAR,
  DEMO_LEGAL_NAME,
  isValidBsn,
  parseDemoRole,
  seedDemo,
} from '../src/demo/index.js'
import { DemoPiiError } from '../src/demo/pii.js'
import { runMigrations } from '../src/migrate.js'
import { entities, salesInvoices } from '../src/schema/index.js'
import {
  withBankRead,
  withLedger,
  withPurchaseRead,
  withReporting,
  withSalesRead,
  withSetup,
  withVatRead,
} from '../src/unit-of-work.js'
import { TEST_DATABASE_URL } from './support/fixture.js'

const PEPPOL_ARTEFACTS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'reference-data',
  'peppol',
  'bis-3',
)

const hasPeppolSchematron = REQUIRED_PEPPOL_SCHEMATRON_FILES.every((name) =>
  existsSync(join(PEPPOL_ARTEFACTS, name)),
)

describe('demo seeder', () => {
  let database: Database

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL)
    database = createDatabase({ url: TEST_DATABASE_URL, maxConnections: 4 })
  }, 120_000)

  afterAll(async () => {
    await closeDatabase(database)
  })

  it('isValidBsn implements the Dutch 11-proef', () => {
    // Known-valid nine-digit BSNs (checksum passes).
    expect(isValidBsn('111222333')).toBe(true)
    expect(isValidBsn('123456782')).toBe(true)
    // Wrong length, non-digits, or failing checksum.
    expect(isValidBsn('12345678')).toBe(false)
    expect(isValidBsn('123456789')).toBe(false)
    expect(isValidBsn('abcdefghi')).toBe(false)
  })

  it('rejects a dataset that looks real', () => {
    expect(() => assertDemoDatasetIsFictional()).not.toThrow()

    expect(() =>
      assertFictionalDataset([
        {
          kind: 'customer',
          name: 'Realistic Person',
          email: 'jan.jansen@gmail.com',
          iban: 'NL91ABNA0417164300',
          kvkNumber: '34182361',
          notes: 'BSN 111222333 on file',
        },
      ]),
    ).toThrow(DemoPiiError)

    try {
      assertFictionalDataset([
        {
          kind: 'customer',
          name: 'Realistic Person',
          email: 'jan.jansen@gmail.com',
          iban: 'NL91ABNA0417164300',
          kvkNumber: '34182361',
          notes: 'BSN 111222333 on file',
        },
      ])
    } catch (error) {
      expect(error).toBeInstanceOf(DemoPiiError)
      const findings = (error as DemoPiiError).findings.join('\n')
      expect(findings).toMatch(/IBAN/)
      expect(findings).toMatch(/KvK/)
      expect(findings).toMatch(/email|gmail/i)
      expect(findings).toMatch(/BSN/)
    }
  })

  it('accepts eigenaar as a role alias for owner', () => {
    expect(parseDemoRole('eigenaar')).toBe('owner')
    expect(parseDemoRole('boekhouder')).toBe('bookkeeper')
    expect(parseDemoRole('accountant')).toBe('accountant')
  })

  it('seeds a fictional BV through production posting paths', async () => {
    const prior = await withSetup(database, (setup) => setup.findDemoEntity())

    const first = await seedDemo(database, {
      inviteEmail: 'accountant@example.nl',
      inviteRole: 'accountant',
    })

    if (prior === null) {
      expect(first.created).toBe(true)
      expect(first.seeded).toBe(true)
      expect(first.entityId).toBe(DEMO_ENTITY_ID)
    } else {
      expect(first.created).toBe(false)
      expect(first.entityId).toBe(prior.id)
    }
    expect(first.name).toBe(DEMO_ENTITY_NAME)
    expect(first.trialBalanceDifference).toBe('0')
    expect(first.chainVerified).toBe(true)
    expect(first.counts.contacts).toBeGreaterThanOrEqual(20)
    expect(first.counts.customers).toBeGreaterThanOrEqual(10)
    expect(first.counts.suppliers).toBeGreaterThanOrEqual(10)
    expect(first.counts.salesInvoices).toBeGreaterThanOrEqual(40)
    expect(first.counts.purchaseInvoices).toBeGreaterThanOrEqual(40)
    expect(first.counts.journalEntries).toBeGreaterThanOrEqual(30)
    expect(first.counts.bankTransactions).toBeGreaterThanOrEqual(150)
    expect(first.counts.bankMatched).toBeGreaterThan(0)
    expect(first.counts.bankUnmatched).toBeGreaterThan(0)
    expect(first.counts.filedPeriods).toBeGreaterThanOrEqual(1)

    // PEPPOL-EN16931-R003: every demo sales invoice must carry a BT-10 buyer
    // reference (or BT-13 order reference). Without it, UBL export fails.
    const missingBuyerRef = await database
      .select({ id: salesInvoices.id })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.entityId, first.entityId), isNull(salesInvoices.buyerReference)))
    expect(missingBuyerRef).toEqual([])

    const buyerRefs = await database
      .select({ buyerReference: salesInvoices.buyerReference })
      .from(salesInvoices)
      .where(eq(salesInvoices.entityId, first.entityId))
    expect(buyerRefs.length).toBeGreaterThanOrEqual(40)
    for (const row of buyerRefs) {
      expect(row.buyerReference).toMatch(new RegExp(`^${DEMO_BUYER_REFERENCE_PREFIX}-\\d{4}$`))
    }
    expect(first.invite).toMatchObject({
      email: 'accountant@example.nl',
      role: 'accountant',
    })

    const entity = await withSetup(database, (setup) => setup.findEntity(first.entityId))
    expect(entity?.isDemo).toBe(true)
    expect(entity?.name).toBe(DEMO_ENTITY_NAME)
    expect(entity?.legalName).toBe(DEMO_LEGAL_NAME)

    // Open payables must reconcile with the 1600 supplier subledger.
    const payables = await withPurchaseRead(database, async (purchase) =>
      purchase.reconcileToControlAccount(first.entityId, '1600'),
    )
    expect(payables.difference).toBe(0n)
    expect(payables.subledger).toBe(payables.control)

    // Trial balance and hash chain via the same helpers production uses.
    const trial = await withReporting(database, async (reporting) => {
      const rows = await reporting.trialBalanceRows({
        entityId: first.entityId,
        fiscalYearCode: DEMO_FISCAL_YEAR,
        fromPeriod: 1,
        toPeriod: 12,
        currency: 'EUR',
      })
      return buildTrialBalance(
        {
          entityId: first.entityId,
          currency: 'EUR',
          fiscalYearCode: DEMO_FISCAL_YEAR,
          fromPeriod: 1,
          toPeriod: 12,
          includeZeroRows: false,
        },
        rows,
      )
    })
    expect(trial.difference).toBe(0n)

    const chain = await withLedger(database, async (ledger) =>
      verifyHashChain(await ledger.loadChain(first.entityId)),
    )
    expect(chain.verified).toBe(true)

    // One bank statement with suggested matches on an open line.
    const suggestions = await withBankRead(database, async (bank) => {
      const accounts = await bank.listAccounts(first.entityId)
      expect(accounts).toHaveLength(1)
      const unmatched = await bank.listTransactions({
        entityId: first.entityId,
        bankAccountId: accounts[0]!.id,
        status: 'unmatched',
        limit: 20,
      })
      expect(unmatched.length).toBeGreaterThan(0)
      const candidates = await bank.matchCandidates(first.entityId)
      const rules = await bank.listRules(first.entityId)
      const transaction = await bank.findTransaction(first.entityId, unmatched[0]!.id)
      expect(transaction).not.toBeNull()
      return suggestMatches(transaction!.entry, candidates, rules)
    })
    // Suggestions may be empty for noise lines; the call itself must succeed.
    expect(Array.isArray(suggestions)).toBe(true)

    // Q1 VAT return reconciles with 1500/1510-style control accounts and has no
    // warnings that needed accepting at filing time.
    const vat = await withVatRead(database, async (repository) => {
      const period = parseVatPeriodCode(`${DEMO_FISCAL_YEAR}-Q1`)
      const preview = await repository.buildReturn({
        entityId: first.entityId,
        from: period.from,
        to: period.to,
      })
      const filings = await repository.filings(first.entityId)
      const summary = filings.find(
        (row) => row.periodFrom === period.from && row.periodTo === period.to,
      )
      const filed =
        summary === undefined ? null : await repository.filing(first.entityId, summary.id)
      return { preview, filings, filed }
    })
    expect(vat.preview.periodFrom).toBe(`${DEMO_FISCAL_YEAR}-01-01`)
    expect(vat.filings.length).toBeGreaterThanOrEqual(1)
    expect(vat.preview.findings.filter((finding) => finding.severity === 'warning')).toEqual([])
    expect(vat.preview.findings.filter((finding) => finding.severity === 'blocking')).toEqual([])
    expect(vat.preview.blocked).toBe(false)
    for (const account of vat.preview.reconciliation) {
      expect(account.differenceMinorUnits, account.accountNumber).toBe(0n)
    }
    expect(vat.filed).not.toBeNull()
    expect(vat.filed!.acceptedWarningsBy).toBeNull()
    expect(vat.filed!.owedMinorUnits).toBe(vat.preview.owedMinorUnits)
    expect(vat.filed!.deductibleMinorUnits).toBe(vat.preview.deductibleMinorUnits)

    // Idempotent: a second run does not create another demo administration.
    const second = await seedDemo(database, {
      inviteEmail: 'owner@example.nl',
      inviteRole: 'eigenaar',
    })
    expect(second.created).toBe(false)
    expect(second.seeded).toBe(false)
    expect(second.alreadyPresent).toBe(true)
    expect(second.entityId).toBe(first.entityId)
    expect(second.invite).toMatchObject({ email: 'owner@example.nl', role: 'owner' })

    const demos = await database.select().from(entities).where(eq(entities.isDemo, true))
    expect(demos).toHaveLength(1)
  }, 180_000)

  it('refuses to seed a non-demo administration', async () => {
    const [live] = await database
      .insert(entities)
      .values({
        id: '01948a00-d000-7000-8000-00000000dead',
        name: 'Live BV',
        legalName: 'Live Beheer B.V.',
        functionalCurrency: 'EUR',
        fiscalYearStartMonth: 1,
        isDemo: false,
      })
      .returning({ id: entities.id })

    await expect(seedDemo(database, { entityId: live!.id })).rejects.toThrow(/not marked demo/)

    await database.delete(entities).where(eq(entities.id, live!.id))
  })

  it('emits UBL with BuyerReference for every seeded demo sales invoice', async () => {
    // Relies on the seed from the previous test (same DB). Idempotent seed
    // keeps the entity when already present.
    const seeded = await seedDemo(database)
    const listed = await withSalesRead(database, (sales) =>
      sales.listInvoices({
        entityId: seeded.entityId,
        status: 'issued',
        limit: 100,
      }),
    )
    expect(listed.length).toBeGreaterThanOrEqual(40)

    // Official .sch files are fetched, not in git (same pattern as pain.001 /
    // xmllint). CI runs `pnpm peppol:fetch` first; without them we still assert
    // BT-10 via checkUblRules and the BuyerReference element.
    const schemas = hasPeppolSchematron ? loadSchematronFromDirectory(PEPPOL_ARTEFACTS) : null

    for (const row of listed) {
      const source = await withSalesRead(database, (sales) =>
        sales.loadUblSource(seeded.entityId, row.id),
      )
      expect(source, row.number ?? row.id).not.toBeNull()
      expect(source!.buyerReference).toMatch(new RegExp(`^${DEMO_BUYER_REFERENCE_PREFIX}-\\d{4}$`))

      const document = toUblDocument(source!)
      const ruleCodes = checkUblRules(document).map((violation) => violation.rule)
      expect(ruleCodes, row.number ?? row.id).not.toContain('PEPPOL-EN16931-R003')

      const xml = generateUbl(document)
      expect(xml).toContain(`<cbc:BuyerReference>${source!.buyerReference}</cbc:BuyerReference>`)

      if (schemas !== null) {
        const result = validateAgainst(schemas, xml)
        const rules = [...new Set(result.failures.map((failure) => failure.rule))]
        expect(rules, `${row.number ?? row.id}: ${rules.join(', ')}`).not.toContain(
          'PEPPOL-EN16931-R003',
        )
        expect(result.valid, `${row.number ?? row.id}: ${rules.join(', ')}`).toBe(true)
      }
    }
  }, 180_000)
})
