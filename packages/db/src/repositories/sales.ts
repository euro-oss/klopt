import {
  buildInvoiceEntry,
  dueDate,
  priceInvoice,
  uuidv7,
  type InvoiceLineInput,
  type PostJournalEntryCommand,
  type PricedInvoice,
  type DunnableInvoice,
  type TaxCodeSnapshot,
  type UblInvoiceSource,
  type VatRounding,
} from '@klopt/core'
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import {
  accounts,
  bankTransactionAllocations,
  contactAddresses,
  contacts,
  entities,
  invoiceDeliveries,
  purchaseInvoices,
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

  /**
   * An outstanding receivable brought across from another system (spec 13).
   *
   * Deliberately not `createDraft` followed by `issue`: an imported open item
   * is not a document this administration produced, and putting it through the
   * issuing path would allocate it a number out of our own gapless series. That
   * series is a legal claim about invoices *we* raised, and filling it with
   * another system's history is exactly the corruption it exists to prevent.
   *
   * So the number is Exact's, kept verbatim because dunning and matching are
   * conversations with somebody reading the old number (spec 13), and the
   * counter is left alone.
   *
   * **No lines.** Exact's receivables list carries an outstanding amount, not a
   * document — there is no net/VAT split in it to import, and a line needs a
   * tax code. Inventing a zero-rate line would put a number in the BTW-aangifte
   * that nobody is entitled to. The denormalised totals are all there is, and
   * `taxMinorUnits` is zero because the tax was declared in the old system, in
   * the period it belonged to.
   */
  async createImportedInvoice(request: {
    readonly entityId: string
    readonly contactId: string
    readonly number: string
    readonly issueDate: string
    readonly dueDate: string
    readonly currency: string
    /** Positive. The sign lives in `kind`, as everywhere else. */
    readonly outstanding: bigint
    readonly kind: 'invoice' | 'credit_note'
    readonly reference: string | null
    readonly notes: string
    readonly journalEntryId: string
  }): Promise<string> {
    const id = uuidv7()
    const buyer = await this.buyerSnapshot(request.contactId)

    await this.tx.insert(salesInvoices).values({
      id,
      entityId: request.entityId,
      contactId: request.contactId,
      kind: request.kind,
      status: 'issued',
      ...(buyer ?? {}),
      number: request.number,
      issueDate: request.issueDate,
      // An import can carry a due date before its issue date if the source did;
      // the check constraint would refuse it, and the invoice matters more than
      // the discrepancy.
      dueDate: request.dueDate < request.issueDate ? request.issueDate : request.dueDate,
      currency: request.currency,
      netMinorUnits: request.outstanding,
      taxMinorUnits: 0n,
      totalMinorUnits: request.outstanding,
      reference: request.reference,
      buyerReference: null,
      notes: request.notes,
      journalEntryId: request.journalEntryId,
      creditsInvoiceId: null,
      issuedAt: new Date(),
    })

    return id
  }

  /**
   * Contact ids for the numbers given, for the ones that exist.
   *
   * Read inside the import's own transaction rather than passed in, because
   * the import creates contacts as it goes and has to see its own writes.
   */
  async contactIdsByNumber(
    entityId: string,
    numbers: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (numbers.length === 0) return new Map()

    const rows = await this.tx
      .select({ id: contacts.id, number: contacts.number })
      .from(contacts)
      .where(and(eq(contacts.entityId, entityId), inArray(contacts.number, [...new Set(numbers)])))

    return new Map(rows.map((row) => [row.number, row.id]))
  }

  /** Numbers already used, so an import can refuse to collide rather than fail. */
  async invoiceNumbersInUse(
    entityId: string,
    numbers: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (numbers.length === 0) return new Set()

    const rows = await this.tx
      .select({ number: salesInvoices.number })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.entityId, entityId), inArray(salesInvoices.number, [...numbers])))

    return new Set(rows.flatMap((row) => (row.number === null ? [] : [row.number])))
  }

  /**
   * The buyer's statutory identity, copied off the contact.
   *
   * Read here rather than passed in, so that no caller can issue an invoice
   * without it. The check constraint would refuse the row, but a constraint
   * that fires is a bug somebody has to debug; a snapshot that is always taken
   * is one they never write.
   */
  private async buyerSnapshot(contactId: string) {
    const [contact] = await this.tx
      .select({
        name: contacts.name,
        legalName: contacts.legalName,
        vatNumber: contacts.vatNumber,
        kvkNumber: contacts.kvkNumber,
        countryCode: contacts.countryCode,
        electronicAddress: contacts.electronicAddress,
        electronicAddressScheme: contacts.electronicAddressScheme,
      })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1)

    if (contact === undefined) return null

    const [address] = await this.tx
      .select({
        street: contactAddresses.street,
        houseNumber: contactAddresses.houseNumber,
        postalCode: contactAddresses.postalCode,
        city: contactAddresses.city,
      })
      .from(contactAddresses)
      .where(and(eq(contactAddresses.contactId, contactId), eq(contactAddresses.kind, 'street')))
      .limit(1)

    return {
      buyerName: contact.name,
      buyerLegalName: contact.legalName,
      buyerVatNumber: contact.vatNumber,
      buyerKvkNumber: contact.kvkNumber,
      buyerCountryCode: contact.countryCode,
      buyerStreet: address?.street ?? null,
      buyerHouseNumber: address?.houseNumber ?? null,
      buyerPostalCode: address?.postalCode ?? null,
      buyerCity: address?.city ?? null,
      buyerElectronicAddress: contact.electronicAddress,
      buyerElectronicAddressScheme: contact.electronicAddressScheme,
    }
  }

  async markIssued(request: {
    readonly invoiceId: string
    readonly number: string
    readonly journalEntryId: string
  }): Promise<void> {
    const [invoice] = await this.tx
      .select({ contactId: salesInvoices.contactId })
      .from(salesInvoices)
      .where(eq(salesInvoices.id, request.invoiceId))
      .limit(1)

    const buyer = invoice === undefined ? null : await this.buyerSnapshot(invoice.contactId)

    await this.tx
      .update(salesInvoices)
      .set({
        status: 'issued',
        number: request.number,
        journalEntryId: request.journalEntryId,
        issuedAt: new Date(),
        // Taken now, with the number and the entry: the three things an
        // invoice acquires by becoming a document somebody owes money on.
        ...(buyer ?? {}),
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

  /**
   * Everything a UBL invoice needs, in one read.
   *
   * Separate from `findInvoice` because it is a different question: that one
   * answers "show me this invoice", this one answers "who are the two parties
   * and what are their statutory identifiers". Half the columns here appear on
   * no screen.
   */
  async loadUblSource(entityId: string, invoiceId: string): Promise<UblInvoiceSource | null> {
    const [row] = await this.tx
      .select({
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
        creditsInvoiceId: salesInvoices.creditsInvoiceId,

        sellerName: entities.name,
        sellerLegalName: entities.legalName,
        sellerStreet: entities.street,
        sellerHouseNumber: entities.houseNumber,
        sellerPostalCode: entities.postalCode,
        sellerCity: entities.city,
        sellerCountry: entities.countryCode,
        sellerVatNumber: entities.vatNumber,
        sellerKvkNumber: entities.kvkNumber,
        sellerEndpoint: entities.electronicAddress,
        sellerEndpointScheme: entities.electronicAddressScheme,
        sellerEmail: entities.email,
        sellerPhone: entities.phone,
        sellerIban: entities.iban,
        sellerBic: entities.bic,

        /**
         * The snapshot taken at issue, not today's contact row.
         *
         * `contacts` is current master data: it moves when the customer moves
         * and it is what an erasure request acts on. The document has to say
         * who it was for when it was issued, and keep saying it for seven
         * years. Only the two fields that are not on the invoice at all —
         * where to email it, what number to ring — still come off the contact.
         */
        buyerName: salesInvoices.buyerName,
        buyerLegalName: salesInvoices.buyerLegalName,
        buyerCountry: salesInvoices.buyerCountryCode,
        buyerVatNumber: salesInvoices.buyerVatNumber,
        buyerKvkNumber: salesInvoices.buyerKvkNumber,
        buyerStreet: salesInvoices.buyerStreet,
        buyerHouseNumber: salesInvoices.buyerHouseNumber,
        buyerPostalCode: salesInvoices.buyerPostalCode,
        buyerCity: salesInvoices.buyerCity,
        buyerEndpoint: salesInvoices.buyerElectronicAddress,
        buyerEndpointScheme: salesInvoices.buyerElectronicAddressScheme,
        buyerEmail: contacts.email,
        buyerPhone: contacts.phone,
        contactId: contacts.id,
      })
      .from(salesInvoices)
      .innerJoin(entities, eq(entities.id, salesInvoices.entityId))
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .where(and(eq(salesInvoices.entityId, entityId), eq(salesInvoices.id, invoiceId)))
      .limit(1)

    if (row === undefined || row.number === null) return null

    // BT-25 and BT-26. A credit note that does not name the invoice it corrects
    // is refused outright by NL-R-001, so this is not decoration.
    let precedingNumber: string | null = null
    let precedingDate: string | null = null
    if (row.creditsInvoiceId !== null) {
      const [credited] = await this.tx
        .select({ number: salesInvoices.number, issueDate: salesInvoices.issueDate })
        .from(salesInvoices)
        .where(eq(salesInvoices.id, row.creditsInvoiceId))
        .limit(1)
      precedingNumber = credited?.number ?? null
      precedingDate = credited?.issueDate ?? null
    }

    const lines = await this.tx
      .select({
        lineNumber: salesInvoiceLines.lineNumber,
        description: salesInvoiceLines.description,
        quantity: salesInvoiceLines.quantity,
        unitCode: salesInvoiceLines.unitCode,
        unitPrice: salesInvoiceLines.unitPriceMinorUnits,
        net: salesInvoiceLines.netMinorUnits,
        tax: salesInvoiceLines.taxMinorUnits,
        ublCategory: taxCodes.ublCategory,
        rateBasisPoints: taxCodes.rateBasisPoints,
        taxDescription: taxCodes.description,
      })
      .from(salesInvoiceLines)
      .innerJoin(taxCodes, eq(taxCodes.id, salesInvoiceLines.taxCodeId))
      .where(eq(salesInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(salesInvoiceLines.lineNumber))

    return {
      profile: 'peppol-bis-3',
      kind: row.kind,
      number: row.number,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      currency: row.currency,
      buyerReference: row.buyerReference,
      orderReference: row.reference,
      note: row.notes,
      precedingInvoiceNumber: precedingNumber,
      precedingInvoiceIssueDate: precedingDate,
      seller: {
        legalName: row.sellerLegalName,
        tradingName: row.sellerName,
        street: row.sellerStreet,
        houseNumber: row.sellerHouseNumber,
        postalCode: row.sellerPostalCode,
        city: row.sellerCity,
        countryCode: row.sellerCountry,
        vatNumber: row.sellerVatNumber,
        kvkNumber: row.sellerKvkNumber,
        // BT-34 defaults to the KvK number in scheme 0106 when nothing else is
        // configured: it is the identifier a Dutch business already has, and
        // NL-R-003 accepts it.
        electronicAddress: row.sellerEndpoint ?? row.sellerKvkNumber,
        electronicAddressScheme:
          row.sellerEndpointScheme ?? (row.sellerKvkNumber === null ? null : '0106'),
        contactName: null,
        phone: row.sellerPhone,
        email: row.sellerEmail,
      },
      buyer: {
        legalName: row.buyerLegalName ?? row.buyerName ?? '',
        tradingName: row.buyerName ?? '',
        street: row.buyerStreet,
        houseNumber: row.buyerHouseNumber,
        postalCode: row.buyerPostalCode,
        city: row.buyerCity,
        countryCode: row.buyerCountry ?? 'NL',
        vatNumber: row.buyerVatNumber,
        kvkNumber: row.buyerKvkNumber,
        electronicAddress: row.buyerEndpoint ?? row.buyerKvkNumber,
        electronicAddressScheme:
          row.buyerEndpointScheme ?? (row.buyerKvkNumber === null ? null : '0106'),
        contactName: null,
        phone: row.buyerPhone,
        email: row.buyerEmail,
      },
      iban: row.sellerIban,
      bic: row.sellerBic,
      net: row.net,
      tax: row.tax,
      total: row.total,
      lines: lines.map((line) => ({
        lineNumber: line.lineNumber,
        description: line.description,
        quantity: line.quantity,
        unitCode: line.unitCode,
        unitPrice: line.unitPrice,
        net: line.net,
        tax: line.tax,
        ublCategory: line.ublCategory,
        rateBasisPoints: line.rateBasisPoints,
        taxDescription: line.taxDescription,
      })),
    }
  }

  /**
   * Record what was sent, whether or not it arrived.
   *
   * "Store the exact bytes sent" (spec 7.5) — the hash of the UBL rather than
   * the UBL itself: the document is reproducible from the invoice, and the hash
   * is what proves the reproduction matches what went out. A failed attempt is
   * recorded too, because "we tried and it bounced" is the answer to a customer
   * who says they never got it.
   */
  async recordDelivery(request: {
    readonly entityId: string
    readonly invoiceId: string
    readonly channel: string
    readonly recipient: string
    readonly documentHash: string | null
    readonly transport: string
    readonly transportMessageId: string | null
    readonly delivered: boolean
    readonly failure: string | null
    readonly purpose: 'invoice' | 'reminder'
    readonly dunningStage: number | null
  }): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(invoiceDeliveries).values({ id, ...request })
    return id
  }

  async deliveriesFor(entityId: string, invoiceId: string) {
    return this.tx
      .select({
        id: invoiceDeliveries.id,
        channel: invoiceDeliveries.channel,
        recipient: invoiceDeliveries.recipient,
        transport: invoiceDeliveries.transport,
        transportMessageId: invoiceDeliveries.transportMessageId,
        documentHash: invoiceDeliveries.documentHash,
        delivered: invoiceDeliveries.delivered,
        failure: invoiceDeliveries.failure,
        purpose: invoiceDeliveries.purpose,
        dunningStage: invoiceDeliveries.dunningStage,
        sentAt: invoiceDeliveries.sentAt,
      })
      .from(invoiceDeliveries)
      .where(
        and(eq(invoiceDeliveries.entityId, entityId), eq(invoiceDeliveries.invoiceId, invoiceId)),
      )
      .orderBy(asc(invoiceDeliveries.sentAt))
  }

  /**
   * Every issued invoice that is past its due date, with the reminders already
   * sent for it.
   *
   * Which reminder is *next* is not decided here — `planDunning` in
   * `@klopt/core` does that, from this and today's date. "Outstanding" still
   * means issued and not cancelled until payments land in M2, which overstates
   * the queue for anyone who has been paid and is the honest reading of what
   * this system currently knows.
   */
  async dunnable(entityId: string, asOf: string): Promise<readonly DunnableInvoice[]> {
    const allocated = this.allocatedPerInvoice(entityId)

    const rows = await this.tx
      .select({
        invoiceId: salesInvoices.id,
        number: salesInvoices.number,
        kind: salesInvoices.kind,
        status: salesInvoices.status,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.totalMinorUnits,
        currency: salesInvoices.currency,
        contactName: contacts.name,
        contactEmail: contacts.email,
        allocated: allocated.total,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .leftJoin(allocated, eq(allocated.invoiceId, salesInvoices.id))
      .where(
        and(
          eq(salesInvoices.entityId, entityId),
          eq(salesInvoices.status, 'issued'),
          eq(salesInvoices.kind, 'invoice'),
          lte(salesInvoices.dueDate, asOf),
        ),
      )
      .orderBy(asc(salesInvoices.dueDate))

    if (rows.length === 0) return []

    const reminders = await this.tx
      .select({
        invoiceId: invoiceDeliveries.invoiceId,
        dunningStage: invoiceDeliveries.dunningStage,
      })
      .from(invoiceDeliveries)
      .where(
        and(
          eq(invoiceDeliveries.entityId, entityId),
          eq(invoiceDeliveries.purpose, 'reminder'),
          inArray(
            invoiceDeliveries.invoiceId,
            rows.map((row) => row.invoiceId),
          ),
        ),
      )

    const sentByInvoice = new Map<string, number[]>()
    for (const reminder of reminders) {
      if (reminder.dunningStage === null) continue
      const existing = sentByInvoice.get(reminder.invoiceId) ?? []
      existing.push(reminder.dunningStage)
      sentByInvoice.set(reminder.invoiceId, existing)
    }

    return rows
      .map((row) => ({
        invoiceId: row.invoiceId,
        // An issued invoice always has a number; the column is nullable because
        // a draft does not.
        number: row.number ?? '',
        kind: row.kind,
        status: row.status,
        dueDate: row.dueDate,
        /**
         * What is still owed, not what was invoiced.
         *
         * Before bank matching existed this was the total, and the dunning
         * screen said so in as many words. Now that allocations exist, an
         * invoice that has been paid is not overdue and a partly paid one is
         * overdue for the remainder — which is the number to put in a reminder.
         */
        total: row.total - BigInt(row.allocated ?? '0'),
        currency: row.currency,
        contactName: row.contactName,
        contactEmail: row.contactEmail,
        remindersSent: sentByInvoice.get(row.invoiceId) ?? [],
      }))
      .filter((invoice) => invoice.total > 0n)
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
  /**
   * How much has been allocated to each invoice, as a subquery.
   *
   * The reason "outstanding" finally means something. Every report that asks
   * what is still owed joins this, and the ones that do not are wrong — which
   * is why it lives here rather than being written out twice.
   */
  private allocatedPerInvoice(entityId: string) {
    return this.tx
      .select({
        invoiceId: bankTransactionAllocations.invoiceId,
        total: sql<string>`sum(${bankTransactionAllocations.amountMinorUnits})::text`.as(
          'allocated',
        ),
      })
      .from(bankTransactionAllocations)
      .where(eq(bankTransactionAllocations.entityId, entityId))
      .groupBy(bankTransactionAllocations.invoiceId)
      .as('allocated')
  }

  async overdueInvoices(entityId: string, asOf: string) {
    const allocated = this.allocatedPerInvoice(entityId)

    const rows = await this.tx
      .select({
        id: salesInvoices.id,
        number: salesInvoices.number,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.totalMinorUnits,
        currency: salesInvoices.currency,
        contactName: contacts.name,
        contactEmail: contacts.email,
        allocated: allocated.total,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .leftJoin(allocated, eq(allocated.invoiceId, salesInvoices.id))
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

    // Outstanding, not invoiced. A paid invoice is not overdue.
    return rows
      .map((row) => ({ ...row, total: row.total - BigInt(row.allocated ?? '0') }))
      .filter((row) => row.total > 0n)
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
    readonly legalName?: string | null
    readonly isCustomer: boolean
    readonly isSupplier: boolean
    readonly email: string | null
    readonly phone?: string | null
    readonly vatNumber: string | null
    readonly kvkNumber?: string | null
    readonly countryCode: string
    readonly paymentTermsDays: number
    readonly electronicAddress?: string | null
    readonly electronicAddressScheme?: string | null
    /**
     * Where a payment run sends the money. Without it a supplier cannot be paid.
     *
     * No BIC alongside it: SEPA has been IBAN-only within the EEA since 2016,
     * and a field with nowhere to go is worse than no field.
     */
    readonly iban?: string | null
    readonly address?: {
      readonly street: string | null
      readonly houseNumber: string | null
      readonly postalCode: string | null
      readonly city: string | null
      readonly countryCode: string
    } | null
  }): Promise<string> {
    const id = uuidv7()
    const { address, ...contact } = request

    await this.tx.insert(contacts).values({ id, ...contact })

    // A separate table because UBL and XAF both distinguish a street address
    // from a postal one, and a contact may have both.
    if (address !== null && address !== undefined) {
      await this.tx.insert(contactAddresses).values({
        id: uuidv7(),
        entityId: request.entityId,
        contactId: id,
        kind: 'street',
        ...address,
      })
    }

    return id
  }

  /** One contact with its street address, for an edit screen. */
  async findContact(entityId: string, contactId: string) {
    const [contact] = await this.tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.entityId, entityId), eq(contacts.id, contactId)))
      .limit(1)

    if (contact === undefined) return null

    const [address] = await this.tx
      .select()
      .from(contactAddresses)
      .where(and(eq(contactAddresses.contactId, contactId), eq(contactAddresses.kind, 'street')))
      .limit(1)

    return { contact, address: address ?? null }
  }

  /**
   * Correct a contact.
   *
   * A contact is master data, not a posting: it is corrected in place rather
   * than reversed, because there is no journal here to keep honest. What is
   * already booked keeps pointing at the same row by id, so fixing a mistyped
   * IBAN fixes it for the next payment run without touching a cent of what
   * happened before.
   *
   * The document a contact appears on is a different matter and is not
   * retrospectively changed: an issued invoice's UBL and PDF are stored
   * artefacts, and a name corrected today does not rewrite what was sent last
   * month. That is the same rule as everywhere else — the record of what
   * happened does not move.
   *
   * Only the fields that were sent are written. `undefined` means "leave it",
   * which is what makes a screen able to edit one field without shipping the
   * other fifteen back.
   */
  /**
   * Erase a contact's personal data, leaving the ledger alone (spec 7.6).
   *
   * Everything the invoice needs it already has: the buyer snapshot is taken
   * at issue and lives on `sales_invoices`. What is wiped here is the address
   * book — who we would bill *today* — and nothing that any posting reads.
   *
   * The debiteurennummer stays. It travels into the XAF and it is how a
   * posting finds its subledger account; erasing it would not anonymise
   * anybody, it would break the invoice's link to its own history.
   *
   * `vat_number` and `kvk_number` stay too. They identify a registered
   * business rather than a person, an ICP declaration is a legal record that
   * had to name one, and the VIES proof stored against it is the evidence that
   * the zero rate was allowed.
   *
   * Blocked on the way out, because a contact nobody can name is not one
   * anybody should be able to invoice again by accident.
   */
  async pseudonymiseContact(request: {
    readonly entityId: string
    readonly contactId: string
    readonly pseudonym: string
  }): Promise<void> {
    await this.tx
      .update(contacts)
      .set({
        name: request.pseudonym,
        legalName: null,
        email: null,
        phone: null,
        iban: null,
        notes: null,
        electronicAddress: null,
        electronicAddressScheme: null,
        isBlocked: true,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(contacts.entityId, request.entityId), eq(contacts.id, request.contactId)))

    // Removed rather than blanked: a row of nulls is a record that somebody
    // lived somewhere, and the invoice already keeps the address it was sent
    // to at the time.
    await this.tx
      .delete(contactAddresses)
      .where(
        and(
          eq(contactAddresses.entityId, request.entityId),
          eq(contactAddresses.contactId, request.contactId),
        ),
      )
  }

  async updateContact(request: {
    readonly entityId: string
    readonly contactId: string
    readonly patch: {
      readonly number?: string | undefined
      readonly name?: string | undefined
      readonly legalName?: string | null | undefined
      readonly isCustomer?: boolean | undefined
      readonly isSupplier?: boolean | undefined
      readonly isBlocked?: boolean | undefined
      readonly email?: string | null | undefined
      readonly phone?: string | null | undefined
      readonly vatNumber?: string | null | undefined
      readonly kvkNumber?: string | null | undefined
      readonly countryCode?: string | undefined
      readonly paymentTermsDays?: number | undefined
      readonly electronicAddress?: string | null | undefined
      readonly electronicAddressScheme?: string | null | undefined
      readonly iban?: string | null | undefined
      readonly notes?: string | null | undefined
    }
    readonly address?: {
      readonly street: string | null
      readonly houseNumber: string | null
      readonly postalCode: string | null
      readonly city: string | null
      readonly countryCode: string
    } | null
  }): Promise<void> {
    // Only the keys that were actually sent. A `set` with `field: undefined`
    // in it is a `set` that writes nothing at all in Drizzle, so filtering here
    // is what keeps "patch one field" from silently becoming "patch nothing".
    const fields = Object.fromEntries(
      Object.entries(request.patch).filter(([, value]) => value !== undefined),
    )

    if (Object.keys(fields).length > 0) {
      await this.tx
        .update(contacts)
        .set({ ...fields, updatedAt: new Date().toISOString() })
        .where(and(eq(contacts.entityId, request.entityId), eq(contacts.id, request.contactId)))
    }

    if (request.address === undefined) return

    const [existing] = await this.tx
      .select({ id: contactAddresses.id })
      .from(contactAddresses)
      .where(
        and(eq(contactAddresses.contactId, request.contactId), eq(contactAddresses.kind, 'street')),
      )
      .limit(1)

    if (request.address === null) {
      if (existing !== undefined) {
        await this.tx.delete(contactAddresses).where(eq(contactAddresses.id, existing.id))
      }
      return
    }

    if (existing === undefined) {
      await this.tx.insert(contactAddresses).values({
        id: uuidv7(),
        entityId: request.entityId,
        contactId: request.contactId,
        kind: 'street',
        ...request.address,
      })
      return
    }

    await this.tx
      .update(contactAddresses)
      .set({ ...request.address, updatedAt: new Date().toISOString() })
      .where(eq(contactAddresses.id, existing.id))
  }

  /**
   * What would be left dangling if this contact stopped being a customer or a
   * supplier.
   *
   * Not a count of everything they ever had: a contact with a paid history is
   * fine to reclassify. What matters is what is still *open*, because an
   * invoice whose counterparty is no longer a customer disappears from the
   * screens that chase it while staying in the ledger that counts it.
   */
  async openDocumentCounts(
    entityId: string,
    contactId: string,
  ): Promise<{ readonly sales: number; readonly purchase: number }> {
    // Issued and not fully paid, or still a draft. `status` alone does not say
    // it — an issued invoice stays `issued` until it is credited — so this is
    // the same allocation join every other "what is still owed" question uses.
    const allocated = this.allocatedPerInvoice(entityId)
    const salesRows = await this.tx
      .select({ total: salesInvoices.totalMinorUnits, allocated: allocated.total })
      .from(salesInvoices)
      .leftJoin(allocated, eq(allocated.invoiceId, salesInvoices.id))
      .where(
        and(
          eq(salesInvoices.entityId, entityId),
          eq(salesInvoices.contactId, contactId),
          inArray(salesInvoices.status, ['draft', 'issued']),
          isNull(salesInvoices.creditsInvoiceId),
        ),
      )

    const sales = salesRows.filter((row) => row.total - BigInt(row.allocated ?? '0') !== 0n).length

    const [purchase] = await this.tx
      .select({ count: sql<string>`count(*)` })
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.entityId, entityId),
          eq(purchaseInvoices.contactId, contactId),
          inArray(purchaseInvoices.status, ['draft', 'booked', 'approved', 'disputed']),
        ),
      )

    return { sales, purchase: Number(purchase?.count ?? '0') }
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
        // Spec 7.2's rule, not just the rate: a client picking a tax code
        // should be able to see which box on the aangifte it feeds.
        baseRubriek: taxCodes.baseRubriek,
        vatRubriek: taxCodes.vatRubriek,
        scope: taxCodes.scope,
        reverseCharge: taxCodes.reverseCharge,
        deductibility: taxCodes.deductibility,
        proRataBasisPoints: taxCodes.proRataBasisPoints,
        supplyKind: taxCodes.supplyKind,
        deductionCode: taxCodes.deductionCode,
        validFrom: taxCodes.validFrom,
        validTo: taxCodes.validTo,
      })
      .from(taxCodes)
      .leftJoin(accounts, eq(accounts.id, taxCodes.accountId))
      .where(eq(taxCodes.entityId, entityId))
      .orderBy(asc(taxCodes.code), asc(taxCodes.validFrom))
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
