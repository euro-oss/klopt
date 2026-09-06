import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { ApiError } from '../src/api/errors.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetInvoiceUbl,
  handleIssueInvoice,
} from '../src/api/handlers/sales.js'
import { handleUpdateEntity } from '../src/api/handlers/setup.js'
import { createContactBody, draftInvoiceBody, issueInvoiceBody } from '../src/api/schemas.js'

/**
 * An invoice, out of the database and into UBL (spec 7.5).
 *
 * The core tests cover the mapping and the rules against fixtures. What this
 * covers is the join between them: that the columns the generator needs are the
 * columns the repository reads, and that an administration with no address is
 * refused with the rule that says so rather than producing a document nobody
 * can accept.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let entityId: string
let token: string

const request = (idempotencyKey?: string): Request => {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/api/v1/sales-invoices', { headers })
}

const contextFor = async (idempotencyKey?: string) =>
  resolveRequestContext({ database, request: request(idempotencyKey) })

/** The seller details a Dutch BIS invoice cannot go without. */
const SELLER_DETAILS = {
  legalName: 'Test Beheer B.V.',
  street: 'Keizersgracht',
  houseNumber: '123-B',
  postalCode: '1015 CJ',
  city: 'Amsterdam',
  countryCode: 'NL',
  kvkNumber: '12345678',
  vatNumber: 'NL123456789B01',
  iban: 'NL02ABNA0123456789',
  bic: 'ABNANL2A',
  email: 'facturen@test.nl',
}

async function aCustomer(): Promise<string> {
  const number = `DEB-${randomUUID().slice(0, 8)}`
  await handleCreateContact(
    await contextFor(uuidv7()),
    createContactBody.parse({
      number,
      name: 'Grote Klant N.V.',
      isCustomer: true,
      vatNumber: 'NL987654321B01',
      kvkNumber: '87654321',
      countryCode: 'NL',
      email: 'inkoop@groteklant.nl',
      address: {
        street: 'Coolsingel',
        houseNumber: '42',
        postalCode: '3011 AD',
        city: 'Rotterdam',
        countryCode: 'NL',
      },
    }),
  )
  return number
}

async function anIssuedInvoice(contactNumber: string): Promise<string> {
  const draft = await handleDraftInvoice(
    await contextFor(uuidv7()),
    draftInvoiceBody.parse({
      contactNumber,
      issueDate: '2026-03-15',
      reference: 'PO-9912',
      buyerReference: 'KOSTENPLAATS-42',
      lines: [
        {
          description: 'Advieswerk maart 2026',
          quantity: '10',
          unitCode: 'HUR',
          unitPrice: '10000',
          revenueAccountNumber: '8000',
          taxCode: 'H21',
        },
      ],
    }),
  )

  const invoiceId = (draft.body as { id: string }).id
  await handleIssueInvoice(await contextFor(uuidv7()), invoiceId, issueInvoiceBody.parse({}))
  return invoiceId
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  const issued = await issueToken(database, {
    entityId,
    name: 'ubl-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'test',
  })
  token = issued.token
}, 60_000)

afterAll(async () => {
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('an administration that has not been filled in', () => {
  it('is refused, naming the rules rather than producing an unusable document', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())

    let violations: { code: string; path: string | null }[] = []
    try {
      await handleGetInvoiceUbl(await contextFor(), invoiceId)
    } catch (error: unknown) {
      if (!(error instanceof ApiError)) throw error
      violations = [...error.violations]
    }

    const codes = violations.map((item) => item.code)
    // The seeded fixture has a KvK and a VAT number but no address and no IBAN.
    expect(codes).toContain('BR-08')
    expect(codes).toContain('NL-R-002')
    expect(codes).toContain('NL-R-007')
    // And it says which field, so a settings form can point at it.
    expect(violations.find((item) => item.code === 'NL-R-002')?.path).toBe('seller.address')
  })
})

describe('an administration that has been', () => {
  beforeAll(async () => {
    await handleUpdateEntity(await contextFor(), SELLER_DETAILS)
  })

  it('produces a BIS Billing 3.0 invoice with both parties on it', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())
    const result = await handleGetInvoiceUbl(await contextFor(), invoiceId)

    expect(result.filename).toMatch(/\.ubl\.xml$/)
    expect(result.xml).toContain(
      'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    )
    expect(result.xml).toContain('<cbc:RegistrationName>Test Beheer B.V.</cbc:RegistrationName>')
    expect(result.xml).toContain('<cbc:RegistrationName>Grote Klant N.V.</cbc:RegistrationName>')
    expect(result.xml).toContain('<cbc:ID>NL02ABNA0123456789</cbc:ID>')
    expect(result.xml).toContain('<cbc:BuyerReference>KOSTENPLAATS-42</cbc:BuyerReference>')
  })

  it('carries the amounts the ledger posted, to the cent', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())
    const result = await handleGetInvoiceUbl(await contextFor(), invoiceId)

    // 10 hours at 100.00 is 1000.00, plus 21% is 1210.00.
    expect(result.xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">1000.00<')
    expect(result.xml).toContain('<cbc:TaxAmount currencyID="EUR">210.00<')
    expect(result.xml).toContain('<cbc:PayableAmount currencyID="EUR">1210.00<')
  })

  it('defaults the electronic address to the KvK number in scheme 0106', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())
    const result = await handleGetInvoiceUbl(await contextFor(), invoiceId)

    expect(result.xml).toContain('<cbc:EndpointID schemeID="0106">12345678</cbc:EndpointID>')
  })

  it('refuses a draft, which has no invoice number to put in BT-1', async () => {
    const draft = await handleDraftInvoice(
      await contextFor(uuidv7()),
      draftInvoiceBody.parse({
        contactNumber: await aCustomer(),
        issueDate: '2026-03-15',
        buyerReference: 'X',
        lines: [
          {
            description: 'Nog niet verstuurd',
            quantity: '1',
            unitPrice: '10000',
            revenueAccountNumber: '8000',
            taxCode: 'H21',
          },
        ],
      }),
    )

    await expect(
      handleGetInvoiceUbl(await contextFor(), (draft.body as { id: string }).id),
    ).rejects.toThrow(/draft has no number/)
  })

  it('refuses a customer with no address, which is the commonest reason', async () => {
    const number = `DEB-${randomUUID().slice(0, 8)}`
    await handleCreateContact(
      await contextFor(uuidv7()),
      createContactBody.parse({
        number,
        name: 'Klant Zonder Adres B.V.',
        isCustomer: true,
        kvkNumber: '11223344',
        countryCode: 'NL',
      }),
    )
    const invoiceId = await anIssuedInvoice(number)

    let codes: string[] = []
    try {
      await handleGetInvoiceUbl(await contextFor(), invoiceId)
    } catch (error: unknown) {
      if (!(error instanceof ApiError)) throw error
      codes = error.violations.map((item) => item.code)
    }

    expect(codes).toContain('BR-10')
    expect(codes).toContain('NL-R-004')
  })

  it('refuses an invoice from another administration', async () => {
    const other = await seedEntity(database)
    await seedSalesConfiguration(database, other)

    await expect(handleGetInvoiceUbl(await contextFor(), uuidv7())).rejects.toThrow(ApiError)
  })
})
