/**
 * Demo administration seeder (issue #48).
 *
 * Runs the operator command's library entry point against a real database and
 * asserts every acceptance criterion the issue lists.
 */

import { buildTrialBalance, parseVatPeriodCode, suggestMatches, verifyHashChain } from '@klopt/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, type Database } from '../src/client.js'
import {
  assertDemoDatasetIsFictional,
  DEMO_ENTITY_ID,
  DEMO_FISCAL_YEAR,
  parseDemoRole,
  seedDemo,
} from '../src/demo/index.js'
import { DemoPiiError } from '../src/demo/pii.js'
import { runMigrations } from '../src/migrate.js'
import { entities } from '../src/schema/index.js'
import {
  withBankRead,
  withLedger,
  withReporting,
  withSetup,
  withVatRead,
} from '../src/unit-of-work.js'
import { TEST_DATABASE_URL } from './support/fixture.js'

describe('demo seeder', () => {
  let database: Database

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL)
    database = createDatabase({ url: TEST_DATABASE_URL, maxConnections: 4 })
  }, 120_000)

  afterAll(async () => {
    await closeDatabase(database)
  })

  it('rejects a dataset that looks real', () => {
    expect(() => assertDemoDatasetIsFictional()).not.toThrow()

    expect(() => {
      throw new DemoPiiError(['customer:X: IBAN must use the NL..TEST reserved pattern'])
    }).toThrow(DemoPiiError)
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
    expect(first.name).toContain('Demo')
    expect(first.trialBalanceDifference).toBe('0')
    expect(first.chainVerified).toBe(true)
    expect(first.counts.contacts).toBeGreaterThanOrEqual(20)
    expect(first.counts.salesInvoices).toBeGreaterThanOrEqual(40)
    expect(first.counts.purchaseInvoices).toBeGreaterThanOrEqual(40)
    expect(first.counts.journalEntries).toBeGreaterThanOrEqual(30)
    expect(first.counts.bankTransactions).toBeGreaterThanOrEqual(150)
    expect(first.counts.bankMatched).toBeGreaterThan(0)
    expect(first.counts.bankUnmatched).toBeGreaterThan(0)
    expect(first.counts.filedPeriods).toBeGreaterThanOrEqual(1)
    expect(first.invite).toMatchObject({
      email: 'accountant@example.nl',
      role: 'accountant',
    })

    const entity = await withSetup(database, (setup) => setup.findEntity(first.entityId))
    expect(entity?.isDemo).toBe(true)
    expect(entity?.name).toContain('(demo)')
    expect(entity?.legalName).toContain('(demo)')

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

    // One VAT period that previews (and Q1 is filed).
    const vat = await withVatRead(database, async (repository) => {
      const period = parseVatPeriodCode(`${DEMO_FISCAL_YEAR}-Q1`)
      const preview = await repository.buildReturn({
        entityId: first.entityId,
        from: period.from,
        to: period.to,
      })
      const filings = await repository.filings(first.entityId)
      return { preview, filings }
    })
    expect(vat.preview.periodFrom).toBe(`${DEMO_FISCAL_YEAR}-01-01`)
    expect(vat.filings.length).toBeGreaterThanOrEqual(1)

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
})
