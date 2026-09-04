import {
  buildInvoiceEntry,
  dueDate,
  priceInvoice,
  uuidv7,
  type InvoiceLineInput,
  type PostJournalEntryCommand,
  type PricedInvoice,
  type TaxCodeSnapshot,
  type VatRounding,
} from '@klopt/core'
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import {
  accounts,
  contacts,
  entities,
  salesInvoiceLines,
  salesInvoices,
  taxCodes,
} from '../schema/index.js'

/**
 * Sales persistence.
 *
 * The pricing and the journal entry are built by `@klopt/core`; this reads the
 * configuration those functions need, writes the result, and never decides
 * anything itself. Issuing an invoice is a `withSales` transaction that also
 * posts through the ledger repository, so the invoice and its journal entry
 * commit together or not at all.
 */

export interface DraftInvoiceRequest {
  readonly entityId: string
  readonly contactNumber: string
  readonly kind: 'invoice' | 'credit_note'
  readonly issueDate: string
  readonly reference: string | null
  readonly buyerReference: string | null
  readonly notes: string | null
  readonly creditsInvoiceId: string | null
  readonly lines: readonly InvoiceLineInput[]
}

export interface InvoiceContext {
  readonly currency: string
  readonly vatRounding: VatRounding
  readonly contact: {
    id: string
    number: string
    name: string
    paymentTermsDays: number
    isBlocked: boolean
  }
  readonly taxCodes: ReadonlyMap<string, TaxCodeSnapshot>
  readonly taxAccountByCode: ReadonlyMap<string, string>
  readonly revenueAccountNumbers: ReadonlySet<string>
}

export class SalesRepository {
  constructor(private readonly tx: Transaction) {}

  /** Everything pricing and posting need, in one round trip. */
  async loadContext(entityId: string, contactNumber: string): Promise<InvoiceContext | null> {
    const [entity] = await this.tx
      .select({ currency: entities.functionalCurrency, vatRounding: entities.vatRounding })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1)
    if (entity === undefined) return null

    const [contact] = await this.tx
      .select({
        id: contacts.id,
        number: contacts.number,
        name: contacts.name,
        paymentTermsDays: contacts.paymentTermsDays,
        isBlocked: contacts.isBlocked,
      })
      .from(contacts)
      .where(and(eq(contacts.entityId, entityId), eq(contacts.number, contactNumber)))
      .limit(1)
    if (contact === undefined) return null

    const codes = await this.tx
      .select({
        id: taxCodes.id,
        code: taxCodes.code,
        description: taxCodes.description,
        rateBasisPoints: taxCodes.rateBasisPoints,
        isReverseCharge: taxCodes.isReverseCharge,
        ublCategory: taxCodes.ublCategory,
        accountNumber: accounts.number,
      })
      .from(taxCodes)
      .leftJoin(accounts, eq(accounts.id, taxCodes.accountId))
      .where(eq(taxCodes.entityId, entityId))

    const chart = await this.tx
      .select({ number: accounts.number })
      .from(accounts)
      .where(eq(accounts.entityId, entityId))

    return {
      currency: entity.currency,
      vatRounding: entity.vatRounding,
      contact,
      taxCodes: new Map(
        codes.map((code) => [
          code.code,
          {
            id: code.id,
            code: code.code,
            description: code.description,
            rateBasisPoints: code.rateBasisPoints,
            isReverseCharge: code.isReverseCharge,
            ublCategory: code.ublCategory,
          },
        ]),
      ),
      taxAccountByCode: new Map(
        codes
          .filter((code) => code.accountNumber !== null)
          .map((code) => [code.code, code.accountNumber!]),
      ),
      revenueAccountNumbers: new Set(chart.map((account) => account.number)),
    }
  }

  async createDraft(
    request: DraftInvoiceRequest,
    context: InvoiceContext,
    priced: PricedInvoice,
  ): Promise<string> {
    const id = uuidv7()

    await this.tx.insert(salesInvoices).values({
      id,
      entityId: request.entityId,
      contactId: context.contact.id,
      kind: request.kind,
      status: 'draft',
      number: null,
      issueDate: request.issueDate,
      dueDate: dueDate(request.issueDate, context.contact.paymentTermsDays),
      currency: context.currency,
      netMinorUnits: priced.net,
      taxMinorUnits: priced.tax,
      totalMinorUnits: priced.total,
      reference: request.reference,
      buyerReference: request.buyerReference,
      notes: request.notes,
      journalEntryId: null,
      creditsInvoiceId: request.creditsInvoiceId,
      issuedAt: null,
    })

    const accountIds = await this.accountIdsByNumber(
      request.entityId,
      priced.lines.map((line) => line.revenueAccountNumber),
    )

    await this.tx.insert(salesInvoiceLines).values(
      priced.lines.map((line) => {
        const accountId = accountIds.get(line.revenueAccountNumber)
        if (accountId === undefined) {
          throw new Error(`No account ${line.revenueAccountNumber}.`)
        }
        const taxCode = context.taxCodes.get(line.tax.code)
        if (taxCode === undefined) throw new Error(`No tax code ${line.tax.code}.`)

        return {
          id: uuidv7(),
          entityId: request.entityId,
          invoiceId: id,
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.quantity,
          unitCode: line.unitCode,
          unitPriceMinorUnits: line.unitPrice,
          revenueAccountId: accountId,
          taxCodeId: taxCode.id,
          netMinorUnits: line.net,
          taxMinorUnits: line.tax_,
        }
      }),
    )

    return id
  }

  private async accountIdsByNumber(
    entityId: string,
    numbers: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(numbers)]
    if (unique.length === 0) return new Map()

    const rows = await this.tx
      .select({ id: accounts.id, number: accounts.number })
      .from(accounts)
      .where(and(eq(accounts.entityId, entityId), inArray(accounts.number, unique)))

    return new Map(rows.map((row) => [row.number, row.id]))
  }

  /**
   * The next invoice number, from the same gapless allocator the journal uses.
   *
   * "This is a legal requirement for invoices" (spec 6.2), so it is emphatically
   * not a sequence: a rolled-back issue returns the number to the pool.
   */
  async allocateInvoiceNumber(entityId: string, year: string, prefix: string): Promise<string> {
    // `bigint`, not string: the pool maps Postgres bigints to JS BigInt so no
    // money value can arrive as a float, and this counter comes along for the
    // ride.
    const rows = await this.tx.execute<{ allocate_number: bigint | string }>(
      sql`select klopt.allocate_number(${entityId}::uuid, 'sales_invoice', ${year})`,
    )
    const value = rows[0]?.allocate_number
    if (value === undefined) throw new Error('allocate_number returned nothing')
    return `${prefix}${year}-${String(value).padStart(4, '0')}`
  }

  async markIssued(request: {
    readonly invoiceId: string
    readonly number: string
    readonly journalEntryId: string
  }): Promise<void> {
    await this.tx
      .update(salesInvoices)
      .set({
        status: 'issued',
        number: request.number,
        journalEntryId: request.journalEntryId,
        issuedAt: new Date(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(salesInvoices.id, request.invoiceId))
  }

  async findInvoice(entityId: string, invoiceId: string) {
    const [invoice] = await this.tx
      .select({
        id: salesInvoices.id,
        kind: salesInvoices.kind,
        status: salesInvoices.status,
        number: salesInvoices.number,
        issueDate: salesInvoices.issueDate,
        dueDate: salesInvoices.dueDate,
        currency: salesInvoices.currency,
        net: salesInvoices.netMinorUnits,
        tax: salesInvoices.taxMinorUnits,
        total: salesInvoices.totalMinorUnits,
        reference: salesInvoices.reference,
        buyerReference: salesInvoices.buyerReference,
        notes: salesInvoices.notes,
        journalEntryId: salesInvoices.journalEntryId,
        creditsInvoiceId: salesInvoices.creditsInvoiceId,
        contactId: contacts.id,
        contactNumber: contacts.number,
        contactName: contacts.name,
        contactEmail: contacts.email,
        contactVatNumber: contacts.vatNumber,
        contactCountry: contacts.countryCode,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .where(and(eq(salesInvoices.entityId, entityId), eq(salesInvoices.id, invoiceId)))
      .limit(1)

    if (invoice === undefined) return null

    const lines = await this.tx
      .select({
        lineNumber: salesInvoiceLines.lineNumber,
        description: salesInvoiceLines.description,
        quantity: salesInvoiceLines.quantity,
        unitCode: salesInvoiceLines.unitCode,
        unitPrice: salesInvoiceLines.unitPriceMinorUnits,
        net: salesInvoiceLines.netMinorUnits,
        tax: salesInvoiceLines.taxMinorUnits,
        revenueAccountNumber: accounts.number,
        taxCode: taxCodes.code,
        taxRateBasisPoints: taxCodes.rateBasisPoints,
        ublCategory: taxCodes.ublCategory,
      })
      .from(salesInvoiceLines)
      .innerJoin(accounts, eq(accounts.id, salesInvoiceLines.revenueAccountId))
      .innerJoin(taxCodes, eq(taxCodes.id, salesInvoiceLines.taxCodeId))
      .where(eq(salesInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(salesInvoiceLines.lineNumber))

    return { ...invoice, lines }
  }

  async listInvoices(request: {
    readonly entityId: string
    readonly status: 'draft' | 'issued' | 'cancelled' | null
    readonly limit: number
  }) {
    const conditions = [eq(salesInvoices.entityId, request.entityId)]
    if (request.status !== null) conditions.push(eq(salesInvoices.status, request.status))

    return this.tx
      .select({
        id: salesInvoices.id,
        kind: salesInvoices.kind,
        status: salesInvoices.status,
        number: salesInvoices.number,
        issueDate: salesInvoices.issueDate,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.totalMinorUnits,
        currency: salesInvoices.currency,
        contactNumber: contacts.number,
        contactName: contacts.name,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .where(and(...conditions))
      .orderBy(desc(salesInvoices.issueDate), desc(salesInvoices.number))
      .limit(request.limit)
  }

  /**
   * Issued invoices that are past due and not yet credited.
   *
   * Payment is M2, so "outstanding" here means issued and not cancelled. Once
   * bank matching exists this reads the debtors subledger instead, and the
   * dunning rules on top of it do not change.
   */
  async overdueInvoices(entityId: string, asOf: string) {
    return this.tx
      .select({
        id: salesInvoices.id,
        number: salesInvoices.number,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.totalMinorUnits,
        currency: salesInvoices.currency,
        contactName: contacts.name,
        contactEmail: contacts.email,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .where(
        and(
          eq(salesInvoices.entityId, entityId),
          eq(salesInvoices.status, 'issued'),
          eq(salesInvoices.kind, 'invoice'),
          lte(salesInvoices.dueDate, asOf),
          isNull(salesInvoices.creditsInvoiceId),
        ),
      )
      .orderBy(asc(salesInvoices.dueDate))
  }

  async listContacts(entityId: string, onlyCustomers: boolean) {
    const conditions = [eq(contacts.entityId, entityId)]
    if (onlyCustomers) conditions.push(eq(contacts.isCustomer, true))

    return this.tx
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(asc(contacts.number))
  }

  async createContact(request: {
    readonly entityId: string
    readonly number: string
    readonly name: string
    readonly isCustomer: boolean
    readonly isSupplier: boolean
    readonly email: string | null
    readonly vatNumber: string | null
    readonly countryCode: string
    readonly paymentTermsDays: number
  }): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(contacts).values({ id, ...request })
    return id
  }

  async listTaxCodes(entityId: string) {
    return this.tx
      .select({
        code: taxCodes.code,
        description: taxCodes.description,
        rateBasisPoints: taxCodes.rateBasisPoints,
        direction: taxCodes.direction,
        ublCategory: taxCodes.ublCategory,
        isReverseCharge: taxCodes.isReverseCharge,
        accountNumber: accounts.number,
      })
      .from(taxCodes)
      .leftJoin(accounts, eq(accounts.id, taxCodes.accountId))
      .where(eq(taxCodes.entityId, entityId))
      .orderBy(asc(taxCodes.code))
  }
}

/** Price a draft without touching the database twice. */
export function priceDraft(request: DraftInvoiceRequest, context: InvoiceContext): PricedInvoice {
  return priceInvoice(request.lines, context.taxCodes, context.vatRounding)
}

/** Build the journal command for an invoice about to be issued. */
export function invoiceEntryFor(request: {
  readonly entityId: string
  readonly journalCode: string
  readonly issueDate: string
  readonly invoiceNumber: string
  readonly receivableAccountNumber: string
  readonly isCreditNote: boolean
  readonly reference: string | null
  readonly context: InvoiceContext
  readonly priced: PricedInvoice
}): PostJournalEntryCommand {
  return buildInvoiceEntry(
    {
      entityId: request.entityId,
      journalCode: request.journalCode,
      bookingDate: request.issueDate,
      documentDate: request.issueDate,
      invoiceNumber: request.invoiceNumber,
      contactNumber: request.context.contact.number,
      contactName: request.context.contact.name,
      contactId: request.context.contact.id,
      receivableAccountNumber: request.receivableAccountNumber,
      isCreditNote: request.isCreditNote,
      reference: request.reference,
      currency: request.context.currency,
    },
    request.priced,
    (code) => request.context.taxAccountByCode.get(code) ?? null,
  )
}
