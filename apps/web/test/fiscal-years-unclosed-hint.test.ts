import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { cleanupSeededBackgroundWork, seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleGetBalanceSheet } from '../src/api/handlers/compliance.js'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
} from '../src/api/handlers/purchase.js'
import { handleCreateContact } from '../src/api/handlers/sales.js'
import {
  bookPurchaseInvoiceBody,
  capturePurchaseInvoiceBody,
  createContactBody,
  statementQuery,
} from '../src/api/schemas.js'

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

async function newEntity() {
  const entityId = await seedEntity(database, {
    fiscalYearCode: '2026',
    alsoFiscalYears: ['2025'],
  })
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'fiscal-years-hint-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { token }
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
})

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('balance sheet opening after a prior-year bill', () => {
  it('includes a December 2025 creditor in the 2026 opening', async () => {
    const { token } = await newEntity()
    await handleCreateContact(
      await context(token, uuidv7()),
      createContactBody.parse({
        number: 'CRE-0001',
        name: 'Leverancier B.V.',
        email: 'facturen@leverancier.test',
        vatNumber: 'NL987654321B01',
        isCustomer: false,
        isSupplier: true,
        iban: 'NL02ABNA0123456789',
        paymentTermsDays: 30,
      }),
    )

    const captured = await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capturePurchaseInvoiceBody.parse({
        contactNumber: 'CRE-0001',
        supplierInvoiceNumber: 'DEC-2025-01',
        invoiceDate: '2025-12-15',
        dueDate: '2026-01-14',
        net: '100000',
        tax: '21000',
        total: '121000',
        lines: [
          {
            description: 'December leverancier',
            accountNumber: '4000',
            taxCode: 'VH21',
            net: '100000',
            tax: '21000',
          },
        ],
      }),
    )

    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const range = statementQuery.parse({
      fiscalYear: '2026',
      fromPeriod: 1,
      toPeriod: 12,
      currency: 'EUR',
    })

    const sheet = await handleGetBalanceSheet(await context(token), range)
    const creditors = sheet.body.liabilities.lines.find(
      (line: { accountNumber: string }) => line.accountNumber === '1600',
    )
    expect(creditors?.amount).toBe('121000')
  })
})
