import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import {
  handleCreateContact,
  handleCreateTaxCodes,
  handleDeactivateTaxCode,
  handleDraftInvoice,
  handleIssueInvoice,
  handleListTaxCodeOffers,
  handleListTaxCodes,
} from '../src/api/handlers/sales.js'
import {
  auditLogQuery,
  createContactBody,
  createTaxCodesBody,
  deactivateTaxCodeBody,
  draftInvoiceBody,
  issueInvoiceBody,
} from '../src/api/schemas.js'

/**
 * Insert-only standard VAT codes, role gate, and in-use guard.
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

async function newEntity(permissions: readonly string[] = ['*']) {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'tax-codes-test',
    permissions: [...permissions],
    actorKind: 'script',
    actorId: 'tax-codes-test',
  })
  return { entityId, token }
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
})

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  await closeDatabase(database)
})

describe('tax-codes manage API', () => {
  it('lists codes with inUse and correctionOnly flags', async () => {
    const { token } = await newEntity(['ledger:read'])
    const listed = await handleListTaxCodes(await context(token))
    expect(listed.status).toBe(200)
    const h21 = listed.body.taxCodes.find((row) => row.code === 'H21')
    expect(h21).toMatchObject({
      correctionOnly: false,
      inUse: false,
      ratePercent: '21.00',
    })
    expect(typeof h21?.id).toBe('string')
  })

  it('refuses offers and create when the caller only has ledger:configure', async () => {
    const { token } = await newEntity(['ledger:read', 'ledger:configure'])
    await expect(handleListTaxCodeOffers(await context(token))).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(
      handleCreateTaxCodes(
        await context(token, uuidv7()),
        createTaxCodesBody.parse({ key: 'VERL9-ONTV' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('lets tax-codes:manage add a missing pair atomically', async () => {
    const { token } = await newEntity(['ledger:read', 'tax-codes:manage'])

    // seedSalesConfiguration has no VERL9 pair — offer and insert both halves.
    const offers = await handleListTaxCodeOffers(await context(token))
    expect(offers.status).toBe(200)
    expect(offers.body.offers.some((offer) => offer.key === 'VERL9-ONTV')).toBe(true)

    const created = await handleCreateTaxCodes(
      await context(token, uuidv7()),
      createTaxCodesBody.parse({ key: 'VERL9-ONTV' }),
    )
    expect(created.status).toBe(201)
    expect(created.body.codes).toEqual(['VERL9-ONTV', 'VERL9-VOOR'])

    const listed = await handleListTaxCodes(await context(token))
    const codes = new Set(listed.body.taxCodes.map((row) => row.code))
    expect(codes.has('VERL9-ONTV')).toBe(true)
    expect(codes.has('VERL9-VOOR')).toBe(true)

    const offersAfter = await handleListTaxCodeOffers(await context(token))
    expect(offersAfter.body.offers.some((offer) => offer.key === 'VERL9-ONTV')).toBe(false)

    await expect(
      handleCreateTaxCodes(
        await context(token, uuidv7()),
        createTaxCodesBody.parse({ key: 'VERL9-ONTV' }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses to deactivate a code that is in use on a sales line', async () => {
    const { token } = await newEntity(['*'])

    await handleCreateContact(
      await context(token, uuidv7()),
      createContactBody.parse({
        number: 'C-1',
        name: 'Klant',
        isCustomer: true,
      }),
    )
    const draft = await handleDraftInvoice(
      await context(token, uuidv7()),
      draftInvoiceBody.parse({
        contactNumber: 'C-1',
        kind: 'invoice',
        issueDate: '2026-03-15',
        lines: [
          {
            description: 'Werk',
            quantity: '1',
            unitPrice: '10000',
            revenueAccountNumber: '8000',
            taxCode: 'H21',
          },
        ],
      }),
    )
    await handleIssueInvoice(
      await context(token, uuidv7()),
      draft.body.id,
      issueInvoiceBody.parse({}),
    )

    const listed = await handleListTaxCodes(await context(token))
    const h21 = listed.body.taxCodes.find((row) => row.code === 'H21')
    expect(h21?.inUse).toBe(true)

    await expect(
      handleDeactivateTaxCode(
        await context(token, uuidv7()),
        h21!.id,
        deactivateTaxCodeBody.parse({ validTo: '2026-12-31' }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })

    const l9 = listed.body.taxCodes.find((row) => row.code === 'L9')
    expect(l9?.inUse).toBe(false)
    const closed = await handleDeactivateTaxCode(
      await context(token, uuidv7()),
      l9!.id,
      deactivateTaxCodeBody.parse({ validTo: '2026-12-31' }),
    )
    expect(closed.status).toBe(200)
    expect(closed.body.validTo).toBe('2026-12-31')
  })

  it('refuses a free-form key that is not on the allowlist', async () => {
    const { token } = await newEntity(['tax-codes:manage'])
    await expect(
      handleCreateTaxCodes(
        await context(token, uuidv7()),
        createTaxCodesBody.parse({ key: 'CUSTOM21' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('refuses a deduction-half key and an unknown chart key with 422', async () => {
    const { token } = await newEntity(['tax-codes:manage'])
    await expect(
      handleCreateTaxCodes(
        await context(token, uuidv7()),
        createTaxCodesBody.parse({ key: 'VERL9-VOOR' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(
      handleCreateTaxCodes(
        await context(token, uuidv7()),
        createTaxCodesBody.parse({ key: 'H23' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('refuses PATCH when the caller only has ledger:configure', async () => {
    const { token: configureOnly } = await newEntity(['ledger:read', 'ledger:configure'])
    const listed = await handleListTaxCodes(await context(configureOnly))
    const l9 = listed.body.taxCodes.find((row) => row.code === 'L9' && !row.inUse)
    expect(l9).toBeDefined()

    await expect(
      handleDeactivateTaxCode(
        await context(configureOnly, uuidv7()),
        l9!.id,
        deactivateTaxCodeBody.parse({ validTo: '2026-12-31' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('ends an unused code, audits it, restores with validTo null, and audits again', async () => {
    const { token } = await newEntity(['ledger:read', 'ledger:export', 'tax-codes:manage'])
    const listed = await handleListTaxCodes(await context(token))
    const l9 = listed.body.taxCodes.find((row) => row.code === 'L9' && !row.inUse)
    expect(l9).toBeDefined()

    const ended = await handleDeactivateTaxCode(
      await context(token, uuidv7()),
      l9!.id,
      deactivateTaxCodeBody.parse({ validTo: '2026-06-30' }),
    )
    expect(ended.status).toBe(200)
    expect(ended.body.validTo).toBe('2026-06-30')

    const endLog = await handleListAuditLog(
      await context(token),
      auditLogQuery.parse({ action: 'sales.deactivateTaxCode' }),
    )
    expect(endLog.body.entries.length).toBeGreaterThanOrEqual(1)
    expect(endLog.body.entries[0]?.after).toMatchObject({
      validTo: '2026-06-30',
      code: 'L9',
    })

    const restored = await handleDeactivateTaxCode(
      await context(token, uuidv7()),
      l9!.id,
      deactivateTaxCodeBody.parse({ validTo: null }),
    )
    expect(restored.status).toBe(200)
    expect(restored.body.validTo).toBeNull()

    const after = await handleListTaxCodes(await context(token))
    expect(after.body.taxCodes.find((row) => row.code === 'L9')?.validTo).toBeNull()

    const restoreLog = await handleListAuditLog(
      await context(token),
      auditLogQuery.parse({ action: 'sales.deactivateTaxCode' }),
    )
    expect(restoreLog.body.entries[0]?.after).toMatchObject({
      validTo: null,
      code: 'L9',
    })
    expect(restoreLog.body.entries[0]?.before).toMatchObject({ validTo: '2026-06-30' })
  })

  it('audits createTaxCodes with key, codes and validFrom', async () => {
    const { token } = await newEntity(['ledger:read', 'ledger:export', 'tax-codes:manage'])
    await handleCreateTaxCodes(
      await context(token, uuidv7()),
      createTaxCodesBody.parse({ key: 'VERL9-ONTV' }),
    )
    const log = await handleListAuditLog(
      await context(token),
      auditLogQuery.parse({ action: 'sales.createTaxCodes' }),
    )
    expect(log.body.entries).toHaveLength(1)
    expect(log.body.entries[0]?.after).toMatchObject({
      key: 'VERL9-ONTV',
      codes: ['VERL9-ONTV', 'VERL9-VOOR'],
    })
    expect(typeof (log.body.entries[0]?.after as { validFrom?: string }).validFrom).toBe('string')
  })
})
