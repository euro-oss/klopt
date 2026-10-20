import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, runMigrations, type Database } from '../src/index.js'
import { withXafExport } from '../src/unit-of-work.js'
import { accounts, taxCodes } from '../src/schema/index.js'
import { seedEntity } from '../src/testing.js'

/**
 * Migration 0036 backfills missing nl-mkb VAT codes; XAF lists every code.
 *
 * The chart file is the source of truth for new administrations. This pins the
 * INSERT-only, idempotent backfill for entities that already look like nl-mkb,
 * and that those codes appear in an XAF export's vatCodes block.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '0036_nl_mkb_missing_vat_codes.sql',
)

const NEW_CODES = [
  'L6',
  'H19',
  'VL6',
  'VH19',
  'VGEEN',
  'VERL9-ONTV',
  'VERL9-VOOR',
  'ICV9',
  'ICV9-VOOR',
  'INV9',
  'INV9-VOOR',
] as const

let database: Database

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
})

afterAll(async () => {
  await closeDatabase(database)
})

async function seedNlMkbAnchors(entityId: string): Promise<void> {
  const rows = await database
    .select({ id: accounts.id, number: accounts.number })
    .from(accounts)
    .where(and(eq(accounts.entityId, entityId), inArray(accounts.number, ['1500', '1510'])))
  const payable = rows.find((row) => row.number === '1500')?.id ?? null
  const receivable = rows.find((row) => row.number === '1510')?.id ?? null

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
      validFrom: '2025-01-01',
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
      validFrom: '2025-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'VERL-ONTV',
      description: 'BTW verlegd naar u, verschuldigd',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: payable,
      isReverseCharge: true,
      reverseCharge: 'domestic',
      ublCategory: 'AE',
      baseRubriek: '2a',
      vatRubriek: '2a',
      scope: 'domestic',
      deductionCode: 'VERL-VOOR',
      validFrom: '2025-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'VERL-VOOR',
      description: 'BTW verlegd naar u, voorbelasting',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: receivable,
      ublCategory: 'AE',
      vatRubriek: '5b',
      scope: 'domestic',
      deductibility: 'full',
      validFrom: '2025-01-01',
    },
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
      validFrom: '2025-01-01',
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
      validFrom: '2025-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'INV23',
      description: 'Invoer met artikel 23-verlegging, verschuldigd',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: payable,
      isReverseCharge: true,
      reverseCharge: 'import_article_23',
      ublCategory: 'S',
      baseRubriek: '4a',
      vatRubriek: '4a',
      scope: 'import',
      supplyKind: 'goods',
      deductionCode: 'INV23-VOOR',
      validFrom: '2025-01-01',
    },
    {
      id: uuidv7(),
      entityId,
      code: 'INV23-VOOR',
      description: 'Invoer met artikel 23-verlegging, voorbelasting',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: receivable,
      ublCategory: 'S',
      vatRubriek: '5b',
      scope: 'import',
      deductibility: 'full',
      validFrom: '2025-01-01',
    },
  ])
}

async function applyBackfill(): Promise<void> {
  const source = readFileSync(MIGRATION_PATH, 'utf8')
  // The migrator splits on this marker; the file is one statement.
  const statements = source
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  for (const statement of statements) {
    await database.execute(sql.raw(statement))
  }
}

async function codesFor(entityId: string): Promise<readonly string[]> {
  const rows = await database
    .select({ code: taxCodes.code })
    .from(taxCodes)
    .where(eq(taxCodes.entityId, entityId))
  return rows.map((row) => row.code).sort()
}

describe('0036_nl_mkb_missing_vat_codes', () => {
  it('inserts the missing codes for an nl-mkb-shaped entity and is idempotent', async () => {
    const entityId = await seedEntity(database, { fiscalYearCode: '2025' })
    await seedNlMkbAnchors(entityId)

    expect(await codesFor(entityId)).not.toEqual(expect.arrayContaining([...NEW_CODES]))

    await applyBackfill()
    const afterFirst = await codesFor(entityId)
    for (const code of NEW_CODES) {
      expect(afterFirst).toContain(code)
    }

    const [l6] = await database
      .select({
        rateBasisPoints: taxCodes.rateBasisPoints,
        baseRubriek: taxCodes.baseRubriek,
        vatRubriek: taxCodes.vatRubriek,
        validFrom: taxCodes.validFrom,
        scope: taxCodes.scope,
      })
      .from(taxCodes)
      .where(and(eq(taxCodes.entityId, entityId), eq(taxCodes.code, 'L6')))
      .limit(1)
    expect(l6).toMatchObject({
      rateBasisPoints: 600,
      baseRubriek: '1c',
      vatRubriek: '1c',
      validFrom: '2025-01-01',
      scope: 'domestic',
    })

    const [vgeen] = await database
      .select({
        rateBasisPoints: taxCodes.rateBasisPoints,
        baseRubriek: taxCodes.baseRubriek,
        vatRubriek: taxCodes.vatRubriek,
        scope: taxCodes.scope,
        deductibility: taxCodes.deductibility,
      })
      .from(taxCodes)
      .where(and(eq(taxCodes.entityId, entityId), eq(taxCodes.code, 'VGEEN')))
      .limit(1)
    expect(vgeen).toMatchObject({
      rateBasisPoints: 0,
      baseRubriek: null,
      vatRubriek: null,
      scope: 'out_of_scope',
      deductibility: 'none',
    })

    await applyBackfill()
    expect(await codesFor(entityId)).toEqual(afterFirst)

    const [vl6] = await database
      .select({
        rateBasisPoints: taxCodes.rateBasisPoints,
        vatRubriek: taxCodes.vatRubriek,
        direction: taxCodes.direction,
        validTo: taxCodes.validTo,
      })
      .from(taxCodes)
      .where(and(eq(taxCodes.entityId, entityId), eq(taxCodes.code, 'VL6')))
      .limit(1)
    expect(vl6).toMatchObject({
      rateBasisPoints: 600,
      vatRubriek: '5b',
      direction: 'input',
      validTo: null,
    })
  })

  it('leaves an existing same-name code untouched even when its meaning differs', async () => {
    const entityId = await seedEntity(database, { fiscalYearCode: '2025' })
    await seedNlMkbAnchors(entityId)
    const [receivable] = await database
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.entityId, entityId), eq(accounts.number, '1510')))
      .limit(1)
    await database.insert(taxCodes).values({
      id: uuidv7(),
      entityId,
      code: 'VGEEN',
      description: 'Custom local meaning',
      rateBasisPoints: 2100,
      direction: 'input',
      accountId: receivable?.id ?? null,
      ublCategory: 'S',
      vatRubriek: '5b',
      scope: 'domestic',
      deductibility: 'full',
      validFrom: '2025-01-01',
    })

    await applyBackfill()
    const [row] = await database
      .select({
        description: taxCodes.description,
        rateBasisPoints: taxCodes.rateBasisPoints,
        scope: taxCodes.scope,
      })
      .from(taxCodes)
      .where(and(eq(taxCodes.entityId, entityId), eq(taxCodes.code, 'VGEEN')))
      .limit(1)
    expect(row).toMatchObject({
      description: 'Custom local meaning',
      rateBasisPoints: 2100,
      scope: 'domestic',
    })
  })

  it('inserts a pair only when neither half already exists', async () => {
    const entityId = await seedEntity(database, { fiscalYearCode: '2025' })
    await seedNlMkbAnchors(entityId)
    const [receivable] = await database
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.entityId, entityId), eq(accounts.number, '1510')))
      .limit(1)
    await database.insert(taxCodes).values({
      id: uuidv7(),
      entityId,
      code: 'VERL9-VOOR',
      description: 'Pre-existing half with another meaning',
      rateBasisPoints: 0,
      direction: 'input',
      accountId: receivable?.id ?? null,
      ublCategory: 'O',
      scope: 'out_of_scope',
      deductibility: 'none',
      validFrom: '2025-01-01',
    })

    await applyBackfill()
    const codes = await codesFor(entityId)
    expect(codes).toContain('VERL9-VOOR')
    expect(codes).not.toContain('VERL9-ONTV')
    expect(codes).toContain('ICV9')
    expect(codes).toContain('ICV9-VOOR')
  })

  it('includes the new codes in an XAF export vatCodes block', async () => {
    const entityId = await seedEntity(database, { fiscalYearCode: '2025' })
    await seedNlMkbAnchors(entityId)
    await applyBackfill()

    const document = await withXafExport(database, (repository) =>
      repository.build(
        {
          entityId,
          fiscalYearCode: '2025',
          softwareDesc: 'Klopt',
          softwareVersion: 'test',
          generatedOn: '2025-06-01',
        },
        null,
      ),
    )

    const vatIds = document.vatCodes.map((code) => code.vatID).sort()
    for (const code of NEW_CODES) {
      expect(vatIds).toContain(code)
    }
    expect(document.vatCodes.find((code) => code.vatID === 'L6')?.vatDesc).toBe('BTW overig 6%')
    expect(document.vatCodes.find((code) => code.vatID === 'VL6')?.vatDesc).toBe(
      'Voorbelasting overig 6%',
    )
    expect(document.vatCodes.find((code) => code.vatID === 'VGEEN')?.vatDesc).toBe(
      'Inkoop zonder btw',
    )
    expect(document.vatCodes.find((code) => code.vatID === 'VGEEN')?.vatToClaimAccID).toBe('1510')
  })
})
