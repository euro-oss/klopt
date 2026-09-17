import {
  uuidv7,
  type PayableItem,
  type PayableSupplier,
  type PurchaseInvoiceInput,
  type TaxCodeRule,
} from '@klopt/core'
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { accounts, entities, journalEntries } from '../schema/ledger.js'
import { contacts, taxCodes } from '../schema/sales.js'
import {
  paymentInstructionInvoices,
  purchaseInvoiceAllocations,
  purchaseInvoiceLines,
  purchaseInvoices,
} from '../schema/purchase.js'

/**
 * Purchase invoices, as a subledger.
 *
 * The creditors side of what `SalesRepository` does for debtors, and it
 * reconciles to the payable control account the same way (spec 9.2: "a
 * subledger owns its own detail and reconciles to a control account").
 *
 * The one query worth reading twice is `openItems`. What is outstanding is the
 * invoice total minus everything allocated against it, and the allocations live
 * in two places — a bank payment matched to the invoice, and a payment
 * instruction that settled it. Missing either would put a paid invoice back in
 * the payment run.
 */

export interface PurchaseContext {
  readonly currency: string
  readonly contact: {
    id: string
    number: string
    name: string
    paymentTermsDays: number
    isBlocked: boolean
    iban: string | null
  }
  readonly rules: readonly TaxCodeRule[]
  readonly taxCodeIdByCode: ReadonlyMap<string, string>
  readonly taxAccountByCode: ReadonlyMap<string, string>
  readonly accountIdByNumber: ReadonlyMap<string, string>
  readonly payableAccountNumber: string | null
}

export interface PurchaseInvoiceRow {
  readonly id: string
  readonly status: 'draft' | 'booked' | 'approved' | 'disputed' | 'cancelled'
  readonly kind: 'invoice' | 'credit_note'
  readonly supplierInvoiceNumber: string
  readonly contactNumber: string
  readonly contactName: string
  readonly invoiceDate: string
  readonly dueDate: string
  readonly currency: string
  readonly net: bigint
  readonly tax: bigint
  readonly total: bigint
  /** Paid by a matched bank transaction. */
  readonly allocated: bigint
  /** Still owed: what the control account holds. Bank payments only. */
  readonly outstanding: bigint
  /** Committed to a payment instruction, but not yet paid. */
  readonly scheduled: bigint
  /** What a payment run may still pick up. */
  readonly unscheduled: bigint
  /**
   * `outstanding` as the ledger sees it: a credit note reduces what is owed.
   * The amounts are stored unsigned and the journal flips the sides, so the
   * subledger has to flip them back or it will not equal its control account.
   */
  readonly signedOutstanding: bigint
  readonly journalEntryId: string | null
  /** For `updatedSince`, maintained by a trigger (migration 0029). */
  readonly updatedAt: Date
  readonly approvedBy: string | null
  readonly bookedBy: string | null
  readonly disputedReason: string | null
  readonly paymentReference: string | null
}

/** The four amounts every caller wants, from one row and its allocations. */
function settlement(
  row: { readonly total: bigint; readonly kind: 'invoice' | 'credit_note' },
  allocated: { paid: bigint; scheduled: bigint } | undefined,
): {
  allocated: bigint
  outstanding: bigint
  scheduled: bigint
  unscheduled: bigint
  signedOutstanding: bigint
} {
  const paid = allocated?.paid ?? 0n
  const scheduled = allocated?.scheduled ?? 0n
  const outstanding = row.total - paid
  const unscheduled = outstanding - scheduled
  return {
    allocated: paid,
    outstanding,
    scheduled,
    unscheduled,
    signedOutstanding: row.kind === 'credit_note' ? -outstanding : outstanding,
  }
}

export class PurchaseRepository {
  constructor(private readonly tx: Transaction) {}

  /** Everything checking and posting need, in one round trip. */
  async loadContext(entityId: string, contactNumber: string): Promise<PurchaseContext | null> {
    const [entity] = await this.tx
      .select({ currency: entities.functionalCurrency })
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
        iban: contacts.iban,
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
        validFrom: taxCodes.validFrom,
        validTo: taxCodes.validTo,
        direction: taxCodes.direction,
        baseRubriek: taxCodes.baseRubriek,
        vatRubriek: taxCodes.vatRubriek,
        reverseCharge: taxCodes.reverseCharge,
        scope: taxCodes.scope,
        deductibility: taxCodes.deductibility,
        proRataBasisPoints: taxCodes.proRataBasisPoints,
        supplyKind: taxCodes.supplyKind,
        ublCategory: taxCodes.ublCategory,
        deductionCode: taxCodes.deductionCode,
        accountNumber: accounts.number,
      })
      .from(taxCodes)
      .leftJoin(accounts, eq(accounts.id, taxCodes.accountId))
      .where(eq(taxCodes.entityId, entityId))
      .orderBy(asc(taxCodes.code), desc(taxCodes.validFrom))

    const chart = await this.tx
      .select({ id: accounts.id, number: accounts.number, rgsCode: accounts.rgsCode })
      .from(accounts)
      .where(eq(accounts.entityId, entityId))

    // The creditors control account, from the RGS mapping rather than a
    // hardcoded 1600: a chart written by somebody else will not use it.
    const payable =
      chart.find((account) => account.rgsCode === 'BSchCreHac') ??
      chart.find((account) => account.rgsCode?.startsWith('BSchCre') === true) ??
      chart.find((account) => account.number === '1600')

    return {
      currency: entity.currency,
      contact,
      rules: codes.map((code) => ({
        code: code.code,
        description: code.description,
        rateBasisPoints: code.rateBasisPoints,
        validFrom: code.validFrom,
        validTo: code.validTo,
        direction: code.direction,
        baseRubriek: code.baseRubriek,
        vatRubriek: code.vatRubriek,
        reverseCharge: code.reverseCharge,
        scope: code.scope,
        deductibility: code.deductibility,
        proRataBasisPoints: code.proRataBasisPoints,
        supplyKind: code.supplyKind,
        ublCategory: code.ublCategory,
        deductionCode: code.deductionCode,
      })),
      // The newest window wins, matching how `ruleInForce` reads the list.
      taxCodeIdByCode: new Map([...codes].reverse().map((code) => [code.code, code.id] as const)),
      taxAccountByCode: new Map(
        codes
          .filter((code) => code.accountNumber !== null)
          .map((code) => [code.code, code.accountNumber!]),
      ),
      accountIdByNumber: new Map(chart.map((account) => [account.number, account.id])),
      payableAccountNumber: payable?.number ?? null,
    }
  }

  /**
   * The creditors control account, from the RGS mapping rather than a
   * hardcoded 1600: a chart written by somebody else will not use it.
   */
  async payableAccountNumber(entityId: string): Promise<string | null> {
    const chart = await this.tx
      .select({ number: accounts.number, rgsCode: accounts.rgsCode })
      .from(accounts)
      .where(eq(accounts.entityId, entityId))

    const payable =
      chart.find((account) => account.rgsCode === 'BSchCreHac') ??
      chart.find((account) => account.rgsCode?.startsWith('BSchCre') === true) ??
      chart.find((account) => account.number === '1600')

    return payable?.number ?? null
  }

  async functionalCurrency(entityId: string): Promise<string> {
    const [row] = await this.tx
      .select({ currency: entities.functionalCurrency })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1)

    return row?.currency ?? 'EUR'
  }

  /**
   * Where an inbound document's lines are parked until somebody codes them.
   *
   * The tussenrekening, by its RGS code. An arrival cannot know which cost
   * account it belongs on — that is a judgement about what was bought — so it
   * lands somewhere visible and wrong rather than somewhere invisible and
   * plausible.
   */
  async suspenseAccountNumber(entityId: string): Promise<string | null> {
    const chart = await this.tx
      .select({ number: accounts.number, rgsCode: accounts.rgsCode })
      .from(accounts)
      .where(eq(accounts.entityId, entityId))

    const suspense =
      chart.find((account) => account.rgsCode === 'BVorTusTin') ??
      chart.find((account) => account.rgsCode?.startsWith('BVorTus') === true) ??
      chart.find((account) => account.number === '2000')

    return suspense?.number ?? null
  }

  /** The input codes, in the shape `suggestTaxCode` reads. */
  async taxCodeSuggestions(entityId: string): Promise<
    readonly {
      readonly code: string
      readonly rateBasisPoints: number
      readonly direction: 'output' | 'input'
      readonly ublCategory: string
      readonly scope: string
      readonly reverseCharge: string
      readonly deductibility: string
      readonly isDeductionHalf: boolean
    }[]
  > {
    const rows = await this.tx
      .select({
        code: taxCodes.code,
        rateBasisPoints: taxCodes.rateBasisPoints,
        direction: taxCodes.direction,
        ublCategory: taxCodes.ublCategory,
        scope: taxCodes.scope,
        reverseCharge: taxCodes.reverseCharge,
        deductibility: taxCodes.deductibility,
        deductionCode: taxCodes.deductionCode,
      })
      .from(taxCodes)
      .where(eq(taxCodes.entityId, entityId))
      .orderBy(asc(taxCodes.code))

    // A code another code points at as its deduction half is not a
    // free-standing purchase code, however ordinary it looks.
    const halves = new Set(
      rows.map((row) => row.deductionCode).filter((code): code is string => code !== null),
    )

    return rows.map((row) => ({
      code: row.code,
      rateBasisPoints: row.rateBasisPoints,
      direction: row.direction,
      ublCategory: row.ublCategory,
      scope: row.scope,
      reverseCharge: row.reverseCharge,
      deductibility: row.deductibility,
      isDeductionHalf: halves.has(row.code),
    }))
  }

  /** Whether this supplier has already sent an invoice with this number. */
  async isDuplicate(
    entityId: string,
    contactId: string,
    supplierInvoiceNumber: string,
    exceptId?: string,
  ): Promise<boolean> {
    const rows = await this.tx
      .select({ id: purchaseInvoices.id })
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.entityId, entityId),
          eq(purchaseInvoices.contactId, contactId),
          eq(purchaseInvoices.supplierInvoiceNumber, supplierInvoiceNumber),
          // A cancelled draft does not count: the number was never used.
          ne(purchaseInvoices.status, 'cancelled'),
          exceptId === undefined ? undefined : ne(purchaseInvoices.id, exceptId),
        ),
      )
      .limit(1)

    return rows.length > 0
  }

  async createDraft(request: {
    readonly entityId: string
    readonly contactId: string
    readonly invoice: PurchaseInvoiceInput
    readonly paymentReference: string | null
    readonly notes: string | null
    readonly taxCodeIdByCode: ReadonlyMap<string, string>
    readonly accountIdByNumber: ReadonlyMap<string, string>
  }): Promise<string> {
    const id = uuidv7()

    await this.tx.insert(purchaseInvoices).values({
      id,
      entityId: request.entityId,
      contactId: request.contactId,
      kind: request.invoice.kind,
      status: 'draft',
      supplierInvoiceNumber: request.invoice.supplierInvoiceNumber,
      invoiceDate: request.invoice.invoiceDate,
      dueDate: request.invoice.dueDate,
      currency: request.invoice.currency,
      netMinorUnits: request.invoice.netMinorUnits,
      taxMinorUnits: request.invoice.taxMinorUnits,
      totalMinorUnits: request.invoice.totalMinorUnits,
      paymentReference: request.paymentReference,
      notes: request.notes,
    })

    if (request.invoice.lines.length > 0) {
      await this.tx.insert(purchaseInvoiceLines).values(
        request.invoice.lines.map((line, index) => ({
          id: uuidv7(),
          entityId: request.entityId,
          invoiceId: id,
          lineNumber: index + 1,
          description: line.description,
          accountId: request.accountIdByNumber.get(line.accountNumber)!,
          taxCodeId: request.taxCodeIdByCode.get(line.taxCode)!,
          netMinorUnits: line.netMinorUnits,
          taxMinorUnits: line.taxMinorUnits,
        })),
      )
    }

    return id
  }

  /** The invoice as captured, for checking and posting. */
  async load(
    entityId: string,
    invoiceId: string,
  ): Promise<{
    readonly invoice: PurchaseInvoiceInput
    readonly row: PurchaseInvoiceRow
    readonly contactId: string
  } | null> {
    const [row] = await this.tx
      .select({
        id: purchaseInvoices.id,
        contactId: purchaseInvoices.contactId,
        status: purchaseInvoices.status,
        kind: purchaseInvoices.kind,
        supplierInvoiceNumber: purchaseInvoices.supplierInvoiceNumber,
        invoiceDate: purchaseInvoices.invoiceDate,
        dueDate: purchaseInvoices.dueDate,
        currency: purchaseInvoices.currency,
        net: purchaseInvoices.netMinorUnits,
        tax: purchaseInvoices.taxMinorUnits,
        total: purchaseInvoices.totalMinorUnits,
        journalEntryId: purchaseInvoices.journalEntryId,
        // What a client passes back as `updatedSince` next time (ADR 0053).
        updatedAt: purchaseInvoices.updatedAt,
        approvedBy: purchaseInvoices.approvedBy,
        bookedBy: purchaseInvoices.bookedBy,
        disputedReason: purchaseInvoices.disputedReason,
        paymentReference: purchaseInvoices.paymentReference,
        contactNumber: contacts.number,
        contactName: contacts.name,
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.contactId))
      .where(and(eq(purchaseInvoices.entityId, entityId), eq(purchaseInvoices.id, invoiceId)))
      .limit(1)

    if (row === undefined) return null

    const lines = await this.tx
      .select({
        description: purchaseInvoiceLines.description,
        accountNumber: accounts.number,
        taxCode: taxCodes.code,
        net: purchaseInvoiceLines.netMinorUnits,
        tax: purchaseInvoiceLines.taxMinorUnits,
      })
      .from(purchaseInvoiceLines)
      .innerJoin(accounts, eq(accounts.id, purchaseInvoiceLines.accountId))
      .innerJoin(taxCodes, eq(taxCodes.id, purchaseInvoiceLines.taxCodeId))
      .where(eq(purchaseInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(purchaseInvoiceLines.lineNumber))

    const allocated = await this.allocatedFor(entityId, [invoiceId])

    return {
      contactId: row.contactId,
      invoice: {
        supplierInvoiceNumber: row.supplierInvoiceNumber,
        kind: row.kind,
        invoiceDate: row.invoiceDate,
        dueDate: row.dueDate,
        currency: row.currency,
        netMinorUnits: row.net,
        taxMinorUnits: row.tax,
        totalMinorUnits: row.total,
        lines: lines.map((line) => ({
          description: line.description,
          accountNumber: line.accountNumber,
          taxCode: line.taxCode,
          netMinorUnits: line.net,
          taxMinorUnits: line.tax,
        })),
      },
      row: { ...row, ...settlement(row, allocated.get(invoiceId)) },
    }
  }

  /**
   * What has been settled against each invoice, and how far along it is.
   *
   * The two sources answer different questions and must not be added together.
   * A matched bank transaction means the money is gone: the invoice is no
   * longer owed, and the control account has moved with it. A payment
   * instruction means somebody has scheduled it: the money is still there, the
   * supplier is still a creditor, and the ageing must still show it — but the
   * next payment run must not pick it up a second time.
   *
   * Collapsing the two was a bug: scheduling a payment silently emptied the
   * creditors ageing while account 1600 still carried the liability, so the
   * subledger stopped reconciling the moment anybody prepared a batch.
   */
  private async allocatedFor(
    entityId: string,
    invoiceIds: readonly string[],
  ): Promise<Map<string, { paid: bigint; scheduled: bigint }>> {
    if (invoiceIds.length === 0) return new Map()

    const [fromBank, fromInstructions] = await Promise.all([
      this.tx
        .select({
          invoiceId: purchaseInvoiceAllocations.invoiceId,
          amount: sql<string>`sum(${purchaseInvoiceAllocations.amountMinorUnits})`,
        })
        .from(purchaseInvoiceAllocations)
        .where(
          and(
            eq(purchaseInvoiceAllocations.entityId, entityId),
            inArray(purchaseInvoiceAllocations.invoiceId, [...invoiceIds]),
          ),
        )
        .groupBy(purchaseInvoiceAllocations.invoiceId),
      this.tx
        .select({
          invoiceId: paymentInstructionInvoices.invoiceId,
          amount: sql<string>`sum(${paymentInstructionInvoices.amountMinorUnits})`,
        })
        .from(paymentInstructionInvoices)
        .where(
          and(
            eq(paymentInstructionInvoices.entityId, entityId),
            inArray(paymentInstructionInvoices.invoiceId, [...invoiceIds]),
          ),
        )
        .groupBy(paymentInstructionInvoices.invoiceId),
    ])

    const totals = new Map<string, { paid: bigint; scheduled: bigint }>()
    const add = (invoiceId: string, field: 'paid' | 'scheduled', amount: bigint): void => {
      const seat = totals.get(invoiceId) ?? { paid: 0n, scheduled: 0n }
      totals.set(invoiceId, { ...seat, [field]: seat[field] + amount })
    }
    for (const row of fromBank) add(row.invoiceId, 'paid', BigInt(row.amount))
    for (const row of fromInstructions) add(row.invoiceId, 'scheduled', BigInt(row.amount))
    return totals
  }

  async list(
    entityId: string,
    filter: {
      readonly status?: string
      readonly openOnly?: boolean
      readonly updatedSince?: string | null
    } = {},
  ): Promise<PurchaseInvoiceRow[]> {
    const rows = await this.tx
      .select({
        id: purchaseInvoices.id,
        status: purchaseInvoices.status,
        kind: purchaseInvoices.kind,
        supplierInvoiceNumber: purchaseInvoices.supplierInvoiceNumber,
        invoiceDate: purchaseInvoices.invoiceDate,
        dueDate: purchaseInvoices.dueDate,
        currency: purchaseInvoices.currency,
        net: purchaseInvoices.netMinorUnits,
        tax: purchaseInvoices.taxMinorUnits,
        total: purchaseInvoices.totalMinorUnits,
        journalEntryId: purchaseInvoices.journalEntryId,
        // What a client passes back as `updatedSince` next time (ADR 0053).
        updatedAt: purchaseInvoices.updatedAt,
        approvedBy: purchaseInvoices.approvedBy,
        bookedBy: purchaseInvoices.bookedBy,
        disputedReason: purchaseInvoices.disputedReason,
        paymentReference: purchaseInvoices.paymentReference,
        contactNumber: contacts.number,
        contactName: contacts.name,
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.contactId))
      .where(
        and(
          eq(purchaseInvoices.entityId, entityId),
          filter.status === undefined
            ? undefined
            : eq(
                purchaseInvoices.status,
                filter.status as 'draft' | 'booked' | 'approved' | 'disputed' | 'cancelled',
              ),
          // Inclusive, so a client resuming from the newest `updatedAt` it saw
          // overlaps by a row rather than skipping one.
          // This table predates the shared `timestamps` builder and declares
          // its column in date mode, so the ISO string is converted here.
          filter.updatedSince == null
            ? undefined
            : gte(purchaseInvoices.updatedAt, new Date(filter.updatedSince)),
        ),
      )
      .orderBy(desc(purchaseInvoices.invoiceDate), desc(purchaseInvoices.createdAt))

    const allocated = await this.allocatedFor(
      entityId,
      rows.map((row) => row.id),
    )

    const enriched = rows.map((row) => ({ ...row, ...settlement(row, allocated.get(row.id)) }))

    return filter.openOnly === true
      ? enriched.filter(
          (row) => row.outstanding !== 0n && row.status !== 'cancelled' && row.status !== 'draft',
        )
      : enriched
  }

  /**
   * Aged creditors (spec 8.3: "aged debtors and creditors").
   *
   * Buckets by how long an invoice has been overdue, not by its age: what
   * matters is how late it is, and an invoice on 60-day terms sent last month is
   * not overdue at all.
   */
  async ageing(
    entityId: string,
    asOf: string,
  ): Promise<
    readonly {
      readonly contactNumber: string
      readonly contactName: string
      readonly current: bigint
      readonly upTo30: bigint
      readonly upTo60: bigint
      readonly upTo90: bigint
      readonly over90: bigint
      readonly total: bigint
    }[]
  > {
    // Disputed invoices are included: they are still owed until settled or
    // credited, and leaving them out of the ageing would understate what is
    // outstanding by exactly the amounts somebody is arguing about.
    const open = await this.list(entityId, { openOnly: true })

    const buckets = new Map<
      string,
      {
        contactNumber: string
        contactName: string
        current: bigint
        upTo30: bigint
        upTo60: bigint
        upTo90: bigint
        over90: bigint
        total: bigint
      }
    >()

    const day = 24 * 60 * 60 * 1000
    const reference = Date.parse(asOf)

    for (const row of open) {
      const overdueDays = Math.floor((reference - Date.parse(row.dueDate)) / day)
      const seat = buckets.get(row.contactNumber) ?? {
        contactNumber: row.contactNumber,
        contactName: row.contactName,
        current: 0n,
        upTo30: 0n,
        upTo60: 0n,
        upTo90: 0n,
        over90: 0n,
        total: 0n,
      }

      // Signed, so a credit note reduces the bucket it falls in rather than
      // inflating it. An ageing that adds credit notes to what is owed is an
      // ageing nobody can compare to the control account.
      const amount = row.signedOutstanding
      if (overdueDays <= 0) seat.current += amount
      else if (overdueDays <= 30) seat.upTo30 += amount
      else if (overdueDays <= 60) seat.upTo60 += amount
      else if (overdueDays <= 90) seat.upTo90 += amount
      else seat.over90 += amount

      seat.total += amount
      buckets.set(row.contactNumber, seat)
    }

    return [...buckets.values()].sort((a, b) => a.contactNumber.localeCompare(b.contactNumber))
  }

  /**
   * Everything approved and still outstanding, grouped by supplier.
   *
   * Approved only: `booked` is a liability nobody has authorised and `disputed`
   * is one somebody is arguing about, and neither belongs in a payment run.
   * Credit notes come along too — they are what a supplier's net position is
   * made of, and leaving them out would overpay.
   */
  async payableSuppliers(entityId: string): Promise<PayableSupplier[]> {
    const open = (await this.list(entityId, { openOnly: true })).filter(
      // Approved, and not already committed to an instruction: a document in a
      // batch is spoken for, and netting it twice underpays by its amount.
      (row) => row.status === 'approved' && row.unscheduled !== 0n,
    )
    if (open.length === 0) return []

    const rows = await this.tx
      .select({
        id: contacts.id,
        number: contacts.number,
        name: contacts.name,
        iban: contacts.iban,
        invoiceId: purchaseInvoices.id,
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.contactId))
      .where(
        and(
          eq(purchaseInvoices.entityId, entityId),
          inArray(
            purchaseInvoices.id,
            open.map((row) => row.id),
          ),
        ),
      )

    const contactByInvoice = new Map(rows.map((row) => [row.invoiceId, row]))
    const suppliers = new Map<string, PayableSupplier & { items: PayableItem[] }>()

    for (const row of open) {
      const contact = contactByInvoice.get(row.id)
      if (contact === undefined) continue

      let seat = suppliers.get(contact.id)
      if (seat === undefined) {
        seat = {
          contactId: contact.id,
          contactNumber: contact.number,
          contactName: contact.name,
          iban: contact.iban,
          // SEPA within the EEA is IBAN-only, and the pain.001 writes
          // `NOTPROVIDED` when there is none.
          bic: null,
          items: [],
        }
        suppliers.set(contact.id, seat)
      }

      seat.items.push({
        invoiceId: row.id,
        supplierInvoiceNumber: row.supplierInvoiceNumber,
        kind: row.kind,
        dueDate: row.dueDate,
        // Unsigned. Which direction it pulls is the document kind's business.
        outstandingMinorUnits: row.unscheduled < 0n ? -row.unscheduled : row.unscheduled,
        paymentReference: row.paymentReference,
        currency: row.currency,
      })
    }

    return [...suppliers.values()].sort((a, b) => a.contactNumber.localeCompare(b.contactNumber))
  }

  /** Record which invoices an instruction settles, and for how much. */
  async allocateToInstruction(request: {
    readonly entityId: string
    readonly instructionId: string
    readonly allocations: readonly { invoiceId: string; amountMinorUnits: bigint }[]
  }): Promise<void> {
    if (request.allocations.length === 0) return

    await this.tx.insert(paymentInstructionInvoices).values(
      request.allocations.map((allocation) => ({
        id: uuidv7(),
        entityId: request.entityId,
        instructionId: request.instructionId,
        invoiceId: allocation.invoiceId,
        amountMinorUnits: allocation.amountMinorUnits,
      })),
    )
  }

  /**
   * An outstanding payable brought across from another system (spec 13).
   *
   * Easier than its sales counterpart, because a purchase invoice's number is
   * already somebody else's: "the supplier's number is the number", so an
   * import preserving it is the ordinary case rather than an exception. What is
   * imported is the supplier's own reference where Exact has one (`YourRef`)
   * and Exact's entry number where it does not.
   *
   * Booked rather than draft: an open item is a liability that has already been
   * accepted, and leaving a migrated creditor position sitting in the inbox
   * would hide it from the ageing and from every payment run.
   *
   * No lines, for the same reason as the sales side: the payables list carries
   * an outstanding amount, not a document with a VAT split.
   */
  async createImportedInvoice(request: {
    readonly entityId: string
    readonly contactId: string
    readonly supplierInvoiceNumber: string
    readonly invoiceDate: string
    readonly dueDate: string
    readonly currency: string
    /** Positive. The sign lives in `kind`. */
    readonly outstanding: bigint
    readonly kind: 'invoice' | 'credit_note'
    readonly notes: string
    readonly journalEntryId: string
    /** Who ran the import. A booked invoice has to say who booked it. */
    readonly bookedBy: string
  }): Promise<string> {
    const id = uuidv7()

    await this.tx.insert(purchaseInvoices).values({
      id,
      entityId: request.entityId,
      contactId: request.contactId,
      kind: request.kind,
      status: 'booked',
      bookedBy: request.bookedBy,
      bookedAt: new Date(),
      supplierInvoiceNumber: request.supplierInvoiceNumber,
      invoiceDate: request.invoiceDate,
      dueDate: request.dueDate < request.invoiceDate ? request.invoiceDate : request.dueDate,
      currency: request.currency,
      netMinorUnits: request.outstanding,
      taxMinorUnits: 0n,
      totalMinorUnits: request.outstanding,
      paymentReference: null,
      notes: request.notes,
      journalEntryId: request.journalEntryId,
    })

    return id
  }

  async markBooked(request: {
    readonly entityId: string
    readonly invoiceId: string
    readonly journalEntryId: string
    readonly actorId: string
  }): Promise<void> {
    await this.tx
      .update(purchaseInvoices)
      .set({
        status: 'booked',
        journalEntryId: request.journalEntryId,
        bookedBy: request.actorId,
        bookedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseInvoices.entityId, request.entityId),
          eq(purchaseInvoices.id, request.invoiceId),
        ),
      )
  }

  async transition(request: {
    readonly entityId: string
    readonly invoiceId: string
    readonly to: 'approved' | 'disputed' | 'booked' | 'cancelled'
    readonly actorId: string
    readonly reason: string | null
  }): Promise<void> {
    await this.tx
      .update(purchaseInvoices)
      .set({
        status: request.to,
        // Cleared when the invoice leaves `approved`: an authorisation that no
        // longer applies must not linger next to a disputed invoice.
        approvedBy: request.to === 'approved' ? request.actorId : null,
        approvedAt: request.to === 'approved' ? new Date() : null,
        disputedReason: request.to === 'disputed' ? request.reason : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseInvoices.entityId, request.entityId),
          eq(purchaseInvoices.id, request.invoiceId),
        ),
      )
  }

  /**
   * The payable control account against its subledger.
   *
   * Spec 9.2 wants this as a scheduled check with an alert on drift. Exposed
   * here so both the job and a screen can ask, because a bookkeeper who cannot
   * see the number will not trust the alert.
   */
  async reconcileToControlAccount(
    entityId: string,
    payableAccountNumber: string,
  ): Promise<{
    readonly subledger: bigint
    readonly control: bigint
    readonly difference: bigint
  }> {
    const open = await this.list(entityId, { openOnly: true })
    const subledger = open.reduce((sum, row) => sum + row.signedOutstanding, 0n)

    const [control] = await this.tx
      .select({
        balance: sql<string>`coalesce(sum(l.credit_minor_units - l.debit_minor_units), 0)`,
      })
      .from(sql`klopt.journal_lines l`)
      .innerJoin(sql`klopt.accounts a`, sql`a.id = l.account_id`)
      .where(
        sql`l.entity_id = ${entityId} and a.number = ${payableAccountNumber} and l.subledger_kind = 'supplier'`,
      )

    const controlBalance = BigInt(control?.balance ?? '0')
    return {
      subledger,
      control: controlBalance,
      difference: subledger - controlBalance,
    }
  }

  /** Invoices with an entry, for the reversal path. */
  async bookedEntryIds(entityId: string): Promise<Map<string, string>> {
    const rows = await this.tx
      .select({ id: purchaseInvoices.id, entryId: purchaseInvoices.journalEntryId })
      .from(purchaseInvoices)
      .where(
        and(eq(purchaseInvoices.entityId, entityId), isNotNull(purchaseInvoices.journalEntryId)),
      )

    return new Map(rows.filter((row) => row.entryId !== null).map((row) => [row.id, row.entryId!]))
  }

  /** The entry a booked invoice produced, for the detail screen. */
  async entryNumberFor(entityId: string, entryId: string): Promise<string | null> {
    const [row] = await this.tx
      .select({ number: journalEntries.entryNumber, journalId: journalEntries.journalId })
      .from(journalEntries)
      .where(and(eq(journalEntries.entityId, entityId), eq(journalEntries.id, entryId)))
      .limit(1)

    return row === undefined ? null : String(row.number)
  }
}
