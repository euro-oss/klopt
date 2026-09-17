import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { createHash } from 'node:crypto'
import { ApiError } from '../src/api/errors.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetInvoicePdf,
  handleGetInvoiceUbl,
  handleIssueInvoice,
  handleListContacts,
  handleUpdateContact,
} from '../src/api/handlers/sales.js'
import { handleUpdateEntity } from '../src/api/handlers/setup.js'
import {
  contactsQuery,
  createContactBody,
  draftInvoiceBody,
  issueInvoiceBody,
  updateContactBody,
} from '../src/api/schemas.js'

const hashOf = (xml: string): string => createHash('sha256').update(xml, 'utf8').digest('hex')

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
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
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

  it('is the same bytes every time, even after the customer is renamed', async () => {
    // The document is what was issued, not a re-derivation of it. This used to
    // regenerate from the current database on every request, which meant
    // correcting a customer's name rewrote the invoice sent to them last month
    // and left `invoice_deliveries.document_hash` pointing at bytes nobody
    // could reproduce.
    const number = await aCustomer()
    const invoiceId = await anIssuedInvoice(number)

    const first = await handleGetInvoiceUbl(await contextFor(), invoiceId)
    expect(first.xml).toContain('Grote Klant N.V.')

    const contacts = await handleListContacts(
      await contextFor(),
      contactsQuery.parse({ customersOnly: 'false' }),
    )
    const customer = contacts.body.contacts.find((row) => row.number === number)!
    await handleUpdateContact(
      await contextFor(uuidv7()),
      customer.id,
      updateContactBody.parse({ name: 'Hele Andere Naam N.V.' }),
    )

    const second = await handleGetInvoiceUbl(await contextFor(), invoiceId)
    expect(second.xml).toBe(first.xml)
    expect(second.xml).not.toContain('Hele Andere Naam N.V.')
    // Byte-identical, which is what a recorded document hash is worth.
    expect(hashOf(second.xml)).toBe(hashOf(first.xml))
  })

  it('names the buyer it was issued to, even if nobody downloaded it first', async () => {
    // The sibling test above renames *after* a fetch, so the stored bytes
    // answer. Nothing had covered the window before the first fetch, and in
    // that window there were no bytes to be faithful to: the document was
    // rebuilt from `contacts` as it stood today. A customer who moved between
    // issuing and downloading got last year's invoice with this year's
    // address on it — and the buyer's identity is exactly what the
    // bewaarplicht requires the invoice to keep.
    const number = await aCustomer()
    const invoiceId = await anIssuedInvoice(number)

    const contacts = await handleListContacts(
      await contextFor(),
      contactsQuery.parse({ customersOnly: 'false' }),
    )
    const customer = contacts.body.contacts.find((row) => row.number === number)!
    await handleUpdateContact(
      await contextFor(uuidv7()),
      customer.id,
      updateContactBody.parse({
        name: 'Verhuisd B.V.',
        street: 'Ergens Anders',
        houseNumber: '99',
        postalCode: '9999 ZZ',
        city: 'Maastricht',
      }),
    )

    // First fetch of this invoice, ever.
    const ubl = await handleGetInvoiceUbl(await contextFor(), invoiceId)

    expect(ubl.xml).toContain('Grote Klant N.V.')
    expect(ubl.xml).not.toContain('Verhuisd B.V.')
    expect(ubl.xml).not.toContain('Maastricht')
  })

  it('carries the amounts the ledger posted, to the cent', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())
    const result = await handleGetInvoiceUbl(await contextFor(), invoiceId)

    // 10 hours at 100.00 is 1000.00, plus 21% is 1210.00.
    expect(result.xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">1000.00<')
    expect(result.xml).toContain('<cbc:TaxAmount currencyID="EUR">210.00<')
    expect(result.xml).toContain('<cbc:PayableAmount currencyID="EUR">1210.00<')
  })

  it('writes the tax category code exactly, with no padding', async () => {
    // The regression test for a bug every UBL generated from the database
    // carried since M1: `ubl_category` was `char(2)`, Postgres blank-pads
    // `character(n)`, and so a one-letter code came back over the wire as
    // `'S '`. `<cbc:ID>S </cbc:ID>` is not a code in UNCL5305, which is what
    // BR-CL-18 checks. The golden UBL tests build their fixture by hand and so
    // never saw it, and both `length()` and `::text` strip the padding, so psql
    // showed `S` and only the driver knew.
    const invoiceId = await anIssuedInvoice(await aCustomer())
    const result = await handleGetInvoiceUbl(await contextFor(), invoiceId)

    expect(result.xml).toContain('<cbc:ID>S</cbc:ID>')
    expect(result.xml).not.toMatch(/<cbc:ID>[A-Z]+ +<\/cbc:ID>/)
    // No element anywhere ends in whitespace before its closing tag.
    expect(result.xml).not.toMatch(/ <\/cbc:/)
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

  it('has really been through the published schematron, not only our own rules', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())
    const result = await handleGetInvoiceUbl(await contextFor(), invoiceId)

    // Several hundred assertions from CEN-EN16931-UBL.sch and
    // PEPPOL-EN16931-UBL.sch. A validator that quietly evaluated nothing would
    // also return a document, and this is the difference.
    expect(result.assertionsEvaluated).toBeGreaterThan(500)
    expect(result.warnings).toEqual([])
  })

  it('renders a PDF of it, with the UBL inside when asked', async () => {
    const invoiceId = await anIssuedInvoice(await aCustomer())

    const bare = await handleGetInvoicePdf(await contextFor(), invoiceId, { embedUbl: false })
    expect(bare.contentType).toBe('application/pdf')
    expect(bare.filename).toMatch(/\.pdf$/)
    expect(Buffer.from(bare.bytes).toString('latin1').startsWith('%PDF-')).toBe(true)
    expect(bare.embeddedUbl).toBe(false)

    const hybrid = await handleGetInvoicePdf(await contextFor(), invoiceId, { embedUbl: true })
    expect(hybrid.embeddedUbl).toBe(true)
    expect(Buffer.from(hybrid.bytes).toString('latin1')).toContain('EmbeddedFiles')
    // Bigger, because a whole invoice went in with it.
    expect(hybrid.bytes.length).toBeGreaterThan(bare.bytes.length)
  })

  it('will render a PDF the schematron would reject, but will not embed the UBL', async () => {
    // A PDF is a rendering. Somebody printing a copy for a customer who wants
    // paper should not be stopped by a code-list rule — but the moment the
    // machine-readable payload rides along, it has to be valid.
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

    const pdf = await handleGetInvoicePdf(await contextFor(), invoiceId, { embedUbl: false })
    expect(pdf.contentType).toBe('application/pdf')

    await expect(
      handleGetInvoicePdf(await contextFor(), invoiceId, { embedUbl: true }),
    ).rejects.toThrow(ApiError)
  })

  it('refuses an invoice from another administration', async () => {
    const other = await seedEntity(database)
    await seedSalesConfiguration(database, other)

    await expect(handleGetInvoiceUbl(await contextFor(), uuidv7())).rejects.toThrow(ApiError)
  })
})
