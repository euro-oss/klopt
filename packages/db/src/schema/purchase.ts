import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { accounts, entities, journalEntries } from './ledger.js'
import { contacts, invoiceKind, taxCodes } from './sales.js'
import { bankTransactions, paymentInstructions } from './bank.js'

export const purchaseInvoiceStatus = klopt.enum('purchase_invoice_status', [
  'draft',
  'booked',
  'approved',
  'disputed',
  'cancelled',
])

/**
 * An invoice somebody sent us.
 *
 * Three things separate it from `salesInvoices`, and none of them is the sign:
 *
 * **The supplier's number is the number.** No gapless counter — the document is
 * theirs. Spec 14 wants the original numbers preserved so matching and payment
 * can quote them, and the unique index on (entity, contact, number) is the
 * duplicate guard, because paying an invoice twice is the classic
 * accounts-payable failure.
 *
 * **The stated totals are authoritative.** On a sales invoice we compute the
 * VAT; here the supplier states it and our job is to verify it. So these columns
 * hold what the document says, and the only constraint is the arithmetic the
 * document itself must satisfy.
 *
 * **Booking and approval are separate moments.** An invoice that has arrived is
 * a liability whether anybody has authorised it, and its VAT is deductible in
 * the period of the invoice date — so it is booked on receipt and approved
 * afterwards, and the approval gates payment rather than the ledger.
 */
export const purchaseInvoices = klopt.table(
  'purchase_invoices',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    kind: invoiceKind('kind').notNull().default('invoice'),
    status: purchaseInvoiceStatus('status').notNull().default('draft'),
    /** The supplier's number, exactly as they wrote it. */
    supplierInvoiceNumber: text('supplier_invoice_number').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** As stated on the document. Never recomputed. */
    netMinorUnits: bigint('net_minor_units', { mode: 'bigint' }).notNull(),
    taxMinorUnits: bigint('tax_minor_units', { mode: 'bigint' }).notNull(),
    totalMinorUnits: bigint('total_minor_units', { mode: 'bigint' }).notNull(),
    /** What we quote when we pay: the supplier's payment reference. */
    paymentReference: text('payment_reference'),
    notes: text('notes'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    creditsInvoiceId: uuid('credits_invoice_id'),
    bookedBy: text('booked_by'),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    disputedReason: text('disputed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_invoices_supplier_number').on(
      table.entityId,
      table.contactId,
      table.supplierInvoiceNumber,
    ),
    index('purchase_invoices_contact').on(table.entityId, table.contactId),
    index('purchase_invoices_due').on(table.entityId, table.dueDate),
    index('purchase_invoices_status').on(table.entityId, table.status),
    check('purchase_invoices_dates', sql`${table.dueDate} >= ${table.invoiceDate}`),
    check(
      'purchase_invoices_totals',
      sql`${table.netMinorUnits} + ${table.taxMinorUnits} = ${table.totalMinorUnits}`,
    ),
    check(
      'purchase_invoices_booked_is_complete',
      sql`(${table.status} in ('draft', 'cancelled')) or (${table.journalEntryId} is not null and ${table.bookedBy} is not null)`,
    ),
    check(
      'purchase_invoices_approval_complete',
      sql`(${table.approvedBy} is null) = (${table.approvedAt} is null)`,
    ),
  ],
)

export const purchaseInvoiceLines = klopt.table(
  'purchase_invoice_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    description: text('description').notNull(),
    /**
     * Where the cost lands. No quantity or unit price: on a purchase invoice you
     * code an amount to an account, and inventing a quantity to fill a column
     * would be inventing data the document does not have.
     */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    taxCodeId: uuid('tax_code_id')
      .notNull()
      .references(() => taxCodes.id),
    netMinorUnits: bigint('net_minor_units', { mode: 'bigint' }).notNull(),
    /** The VAT the supplier charged on this line. Zero under a reverse charge. */
    taxMinorUnits: bigint('tax_minor_units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('purchase_invoice_lines_number').on(table.invoiceId, table.lineNumber)],
)

/** A payment allocated against a purchase invoice, mirroring the sales side. */
export const purchaseInvoiceAllocations = klopt.table(
  'purchase_invoice_allocations',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => bankTransactions.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => purchaseInvoices.id),
    /** Unsigned: the direction is the transaction's. */
    amountMinorUnits: bigint('amount_minor_units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_allocations_unique').on(table.transactionId, table.invoiceId),
    index('purchase_allocations_invoice').on(table.invoiceId),
    check('purchase_allocations_positive', sql`${table.amountMinorUnits} > 0`),
  ],
)

/**
 * Which purchase invoices a payment instruction settles.
 *
 * One instruction can pay several invoices, which is what a supplier statement
 * run does — and it is why this is a table rather than a column. It is also
 * what lets a returned payment be traced back to the invoices it was meant to
 * clear.
 */
export const paymentInstructionInvoices = klopt.table(
  'payment_instruction_invoices',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    instructionId: uuid('instruction_id')
      .notNull()
      .references(() => paymentInstructions.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => purchaseInvoices.id),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('payment_instruction_invoices_unique').on(table.instructionId, table.invoiceId),
    index('payment_instruction_invoices_invoice').on(table.invoiceId),
    check('payment_instruction_invoices_positive', sql`${table.amountMinorUnits} > 0`),
  ],
)
