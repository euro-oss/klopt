import { uuidv7 } from '@klopt/core'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Database } from './client.js'
import {
  auditLog,
  accountDimensionRequirements,
  accounts,
  dimensionTypes,
  dimensionValues,
  entities,
  fiscalYears,
  journals,
  periods,
  taxCodes,
  users,
} from './schema/index.js'

/**
 * A fictional Dutch BV to post against (spec 11.4).
 *
 * This is the seed of the reference dataset: a fictional Dutch BV that every
 * export will eventually run against in CI, and that ships as demo data. It
 * lives in the package rather than in a test folder because apps/web's tests
 * and the demo seeder both need it.
 *
 * Built through the same code paths as production, so a schema change that
 * breaks setup breaks the tests too.
 */

export interface SeedOptions {
  readonly fiscalYearCode?: string
  /**
   * Extra fiscal years. A year close posts its opening balance into the next
   * one, so anything exercising a close needs at least two.
   */
  readonly alsoFiscalYears?: readonly string[]
  readonly functionalCurrency?: string
  /** Spec 6.1: per-entity, default per invoice. Both need exercising. */
  readonly vatRounding?: 'per_invoice' | 'per_line'
}

export async function seedEntity(database: Database, options: SeedOptions = {}): Promise<string> {
  const entityId = uuidv7()
  const fiscalYearCode = options.fiscalYearCode ?? '2026'
  const currency = options.functionalCurrency ?? 'EUR'

  await database.insert(entities).values({
    id: entityId,
    name: `Test BV ${entityId.slice(0, 8)}`,
    legalName: 'Test Beheer B.V.',
    kvkNumber: '12345678',
    vatNumber: 'NL123456789B01',
    functionalCurrency: currency,
    fiscalYearStartMonth: 1,
    rgsVersion: '3.7',
    vatRounding: options.vatRounding ?? 'per_invoice',
    // The fixture chart has 4900, so the fixture is configured like a fresh
    // install on the shipped chart. Without this the charge-splitting path was
    // never exercised by anything.
    bankChargesAccountNumber: '4900',
  })

  for (const code of [fiscalYearCode, ...(options.alsoFiscalYears ?? [])]) {
    const fiscalYearId = uuidv7()
    await database.insert(fiscalYears).values({
      id: fiscalYearId,
      entityId,
      code,
      startsOn: `${code}-01-01`,
      endsOn: `${code}-12-31`,
    })

    const year = Number(code)
    await database.insert(periods).values(
      Array.from({ length: 12 }, (_, index) => {
        const month = index + 1
        const start = new Date(Date.UTC(year, index, 1))
        const end = new Date(Date.UTC(year, month, 0))
        return {
          id: uuidv7(),
          entityId,
          fiscalYearId,
          sequence: month,
          startsOn: start.toISOString().slice(0, 10),
          endsOn: end.toISOString().slice(0, 10),
        }
      }),
    )
  }

  await database.insert(journals).values([
    { id: uuidv7(), entityId, code: 'MEM', name: 'Memoriaal', type: 'memoriaal' },
    { id: uuidv7(), entityId, code: 'VRK', name: 'Verkoopboek', type: 'verkoop' },
    { id: uuidv7(), entityId, code: 'INK', name: 'Inkoopboek', type: 'inkoop' },
    { id: uuidv7(), entityId, code: 'BNK', name: 'Bank', type: 'bank' },
  ])

  // A minimal chart, RGS-coded, in the Dutch numbering everyone recognises.
  const chart = [
    { number: '0100', name: 'Inventaris', type: 'asset', dc: 'debit', rgs: 'BMvaBeiVvp' },
    { number: '1000', name: 'Kas', type: 'asset', dc: 'debit', rgs: 'BLimKasKas' },
    { number: '1100', name: 'Bank', type: 'asset', dc: 'debit', rgs: 'BLimBanRba' },
    { number: '1300', name: 'Debiteuren', type: 'asset', dc: 'debit', rgs: 'BVorDeb' },
    { number: '1600', name: 'Crediteuren', type: 'liability', dc: 'credit', rgs: 'BSchCre' },
    { number: '1500', name: 'Te betalen BTW', type: 'liability', dc: 'credit', rgs: 'BSchBepBtw' },
    // Voorbelasting. Needed from M3 on: without it there is nowhere for input
    // VAT to land, so no return could ever have a 5b.
    { number: '1510', name: 'Te vorderen BTW', type: 'asset', dc: 'debit', rgs: 'BVorVbkTvo' },
    { number: '0500', name: 'Eigen vermogen', type: 'equity', dc: 'credit', rgs: 'BEivGokCva' },
    { number: '8000', name: 'Omzet', type: 'revenue', dc: 'credit', rgs: 'WOmzNoo' },
    { number: '4000', name: 'Inkoopwaarde', type: 'expense', dc: 'debit', rgs: 'WKprGrpGr1' },
    { number: '4300', name: 'Brandstofkosten', type: 'expense', dc: 'debit', rgs: 'WBedAutBra' },
    { number: '4900', name: 'Algemene kosten', type: 'expense', dc: 'debit', rgs: 'WBedAlgAnk' },
    { number: '4910', name: 'Bankkosten', type: 'expense', dc: 'debit', rgs: 'WBedAlgBan' },
    { number: '9999', name: 'Geblokkeerd', type: 'expense', dc: 'debit', rgs: null },
  ] as const

  const accountIds = new Map<string, string>()
  await database.insert(accounts).values(
    chart.map((account) => {
      const id = uuidv7()
      accountIds.set(account.number, id)
      return {
        id,
        entityId,
        number: account.number,
        name: account.name,
        type: account.type,
        normalBalance: account.dc,
        rgsCode: account.rgs,
        isBlocked: account.number === '9999',
      }
    }),
  )

  // Two dimension types, because "do not ship a fixed pair" (spec 6.3) is only
  // demonstrably true if the tests use more than cost centre and project.
  const vehicleTypeId = uuidv7()
  const regionTypeId = uuidv7()
  await database.insert(dimensionTypes).values([
    { id: vehicleTypeId, entityId, code: 'VEHICLE', name: 'Voertuig' },
    { id: regionTypeId, entityId, code: 'REGION', name: 'Regio' },
  ])

  await database.insert(dimensionValues).values([
    { id: uuidv7(), entityId, dimensionTypeId: vehicleTypeId, code: 'VAN-01', name: 'Bus 1' },
    { id: uuidv7(), entityId, dimensionTypeId: vehicleTypeId, code: 'VAN-02', name: 'Bus 2' },
    {
      id: uuidv7(),
      entityId,
      dimensionTypeId: vehicleTypeId,
      code: 'VAN-OLD',
      name: 'Verkochte bus',
      isBlocked: true,
    },
    { id: uuidv7(), entityId, dimensionTypeId: regionTypeId, code: 'NOORD', name: 'Noord' },
    { id: uuidv7(), entityId, dimensionTypeId: regionTypeId, code: 'ZUID', name: 'Zuid' },
  ])

  // "Any posting to fuel cost must carry a vehicle."
  await database.insert(accountDimensionRequirements).values({
    accountId: accountIds.get('4300')!,
    dimensionTypeId: vehicleTypeId,
    entityId,
  })

  return entityId
}

/**
 * Look a user up by email.
 *
 * Exposed here rather than leaving callers to reach for Drizzle: a browser test
 * that imports the ORM has to depend on it, and then `apps/web` depends on a
 * database driver it should never touch directly.
 */
export async function findUserIdByEmail(database: Database, email: string): Promise<string | null> {
  const [row] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return row?.id ?? null
}

/**
 * Tax codes and revenue accounts, so the fixture can invoice.
 *
 * Separate from `seedEntity` because the ledger tests do not need it and a
 * fixture that seeds everything hides which parts a feature actually depends
 * on.
 */
export async function seedSalesConfiguration(database: Database, entityId: string): Promise<void> {
  const rows = await database
    .select({ id: accounts.id, number: accounts.number })
    .from(accounts)
    .where(and(eq(accounts.entityId, entityId), inArray(accounts.number, ['1500', '1510'])))

  const accountFor = (number: string) => rows.find((row) => row.number === number)?.id ?? null
  const payable = accountFor('1500')
  const receivable = accountFor('1510')

  // Full rules, not just rates (spec 7.2): every db-backed test posts through
  // these, so a code that could not produce a BTW-aangifte would let the whole
  // suite pass with a return that declares nothing.
  await database.insert(taxCodes).values([
    {
      id: uuidv7(),
      entityId,
      code: 'H21',
      description: 'BTW hoog 21%',
      rateBasisPoints: 2100,
      direction: 'output',
      accountId: payable,
      ublCategory: 'S',
      baseRubriek: '1a',
      vatRubriek: '1a',
      scope: 'domestic',
      validFrom: '2020-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'L9',
      description: 'BTW laag 9%',
      rateBasisPoints: 900,
      direction: 'output',
      accountId: payable,
      ublCategory: 'S',
      baseRubriek: '1b',
      vatRubriek: '1b',
      scope: 'domestic',
      validFrom: '2020-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'VERL',
      description: 'BTW verlegd',
      rateBasisPoints: 0,
      direction: 'output',
      accountId: payable,
      isReverseCharge: true,
      reverseCharge: 'domestic',
      ublCategory: 'AE',
      baseRubriek: '1e',
      scope: 'domestic',
      validFrom: '2020-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'ICP',
      description: 'Intracommunautaire levering goederen 0%',
      rateBasisPoints: 0,
      direction: 'output',
      accountId: payable,
      ublCategory: 'K',
      baseRubriek: '3b',
      scope: 'intra_community_supply',
      supplyKind: 'goods',
      validFrom: '2020-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'VH21',
      description: 'Voorbelasting hoog 21%',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: receivable,
      ublCategory: 'S',
      vatRubriek: '5b',
      scope: 'domestic',
      deductibility: 'full',
      validFrom: '2020-01-01',
    },
    // Representation costs, half deductible. A real Dutch rule shape, and the
    // only way a test can exercise the pro rata split in a purchase posting.
    {
      id: uuidv7(),
      entityId,
      code: 'VH21-PRO',
      description: 'Voorbelasting hoog 21%, 50% aftrekbaar',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: receivable,
      ublCategory: 'S',
      vatRubriek: '5b',
      scope: 'domestic',
      deductibility: 'pro_rata',
      proRataBasisPoints: 5_000,
      validFrom: '2020-01-01',
    },
    // The two halves of an intra-community acquisition. Where M3 and M4
    // interlock: one purchase, two tax codes, rubriek 4b and rubriek 5b.
    {
      id: uuidv7(),
      entityId,
      code: 'ICV21',
      description: 'Intracommunautaire verwerving 21%, verschuldigd',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: payable,
      ublCategory: 'K',
      baseRubriek: '4b',
      vatRubriek: '4b',
      scope: 'intra_community_acquisition',
      supplyKind: 'goods',
      deductionCode: 'ICV21-VOOR',
      validFrom: '2020-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'ICV21-VOOR',
      description: 'Intracommunautaire verwerving 21%, voorbelasting',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: receivable,
      ublCategory: 'K',
      vatRubriek: '5b',
      scope: 'intra_community_acquisition',
      deductibility: 'full',
      validFrom: '2020-01-01',
    },
  ])
}

export interface AuditEntry {
  readonly action: string
  readonly actorId: string
  readonly resourceId: string
  readonly before: unknown
  readonly after: unknown
}

/**
 * The audit trail for one kind of resource.
 *
 * Here rather than in a test file because apps/web must not import an ORM —
 * a browser test that reaches for Drizzle drags a database driver into an app
 * that should never touch one, and the boundary check fails the build.
 */
export async function readAuditLog(
  database: Database,
  entityId: string,
  resourceType: string,
): Promise<AuditEntry[]> {
  const rows = await database
    .select({
      action: auditLog.action,
      actorId: auditLog.actorId,
      resourceId: auditLog.resourceId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, entityId), eq(auditLog.resourceType, resourceType)))
    .orderBy(asc(auditLog.occurredAt))

  return rows
}
