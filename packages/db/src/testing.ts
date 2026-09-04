import { uuidv7 } from '@klopt/core'
import type { Database } from './client.js'
import {
  accountDimensionRequirements,
  accounts,
  dimensionTypes,
  dimensionValues,
  entities,
  fiscalYears,
  journals,
  periods,
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
    { number: '0500', name: 'Eigen vermogen', type: 'equity', dc: 'credit', rgs: 'BEivGokCva' },
    { number: '8000', name: 'Omzet', type: 'revenue', dc: 'credit', rgs: 'WOmzNoo' },
    { number: '4000', name: 'Inkoopwaarde', type: 'expense', dc: 'debit', rgs: 'WKprGrpGr1' },
    { number: '4300', name: 'Brandstofkosten', type: 'expense', dc: 'debit', rgs: 'WBedAutBra' },
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
