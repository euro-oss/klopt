import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { timestamps } from './columns.js'
import { accounts, entities, journalEntries } from './ledger.js'

/**
 * Sales (M1), and the shared kernel underneath it.
 *
 * "Contacts, addresses, items and attachments live in a shared core that a
 * future inventory or project module reuses rather than duplicates" (spec 9.4).
 * So `contacts` is not a customers table: it carries `is_customer` and
 * `is_supplier` flags, and Purchase in M4 adds nothing to it.
 */

export const contactKind = klopt.enum('contact_kind', ['company', 'person'])

export const invoiceKind = klopt.enum('invoice_kind', ['invoice', 'credit_note'])

/**
 * `draft` is editable and unposted. `issued` has a number, a journal entry and
 * a hash chain position, and is therefore final — a wrong invoice is corrected
 * with a credit note, never an edit.
 */
export const invoiceStatus = klopt.enum('invoice_status', ['draft', 'issued', 'cancelled'])

export const taxDirection = klopt.enum('tax_direction', ['output', 'input'])

export const contacts = klopt.table(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    /** Debiteurennummer. Unique per entity, and it travels into the XAF. */
    number: text('number').notNull(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    kind: contactKind('kind').notNull().default('company'),
    isCustomer: boolean('is_customer').notNull().default(false),
    isSupplier: boolean('is_supplier').notNull().default(false),
    /** BTW-nummer. Validated against VIES in M3, when ICP needs it. */
    vatNumber: text('vat_number'),
    kvkNumber: text('kvk_number'),
    countryCode: char('country_code', { length: 2 }).notNull().default('NL'),
    email: text('email'),
    phone: text('phone'),
    iban: text('iban'),
    /** Betalingstermijn. Drives the due date and therefore the dunning clock. */
    paymentTermsDays: smallint('payment_terms_days').notNull().default(30),
    notes: text('notes'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    unique('contacts_entity_number').on(table.entityId, table.number),
    index('contacts_entity_name').on(table.entityId, table.name),
    check(
      'contacts_payment_terms_range',
      sql`${table.paymentTermsDays} >= 0 and ${table.paymentTermsDays} <= 365`,
    ),
  ],
)

export const contactAddresses = klopt.table(
  'contact_addresses',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    /** `street` or `postal`. UBL and XAF both distinguish them. */
    kind: text('kind').notNull().default('street'),
    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    region: text('region'),
    countryCode: char('country_code', { length: 2 }).notNull().default('NL'),
    ...timestamps,
  },
  (table) => [index('contact_addresses_contact').on(table.contactId)],
)

/**
 * Tax codes, in the minimal form invoicing needs.
 *
 * The real engine is M3: rubrieken, reverse charge, pro rata, ICP. What is here
 * is what a sales invoice cannot be written without — a rate, a direction, and
 * the account the tax lands on. The M3 columns extend this table rather than
 * replacing it, which is why `rate_basis_points` is already an integer and the
 * validity window already exists.
 */
export const taxCodes = klopt.table(
  'tax_codes',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    code: text('code').notNull(),
    description: text('description').notNull(),
    /** 2100 is 21%. Basis points, because a percentage is not a float. */
    rateBasisPoints: integer('rate_basis_points').notNull(),
    direction: taxDirection('direction').notNull(),
    /** Where the tax is booked. Te betalen BTW for output. */
    accountId: uuid('account_id').references(() => accounts.id),
    /** Verleggingsregeling. The full treatment lands in M3. */
    isReverseCharge: boolean('is_reverse_charge').notNull().default(false),
    /**
     * The UBL/Peppol category: S standard, Z zero, E exempt, AE reverse charge,
     * K intra-community, G export. Needed by NLCIUS from the first invoice.
     */
    ublCategory: char('ubl_category', { length: 2 }).notNull().default('S'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    ...timestamps,
  },
  (table) => [
    unique('tax_codes_entity_code').on(table.entityId, table.code),
    check('tax_codes_rate_range', sql`${table.rateBasisPoints} between 0 and 10000`),
  ],
)

export const salesInvoices = klopt.table(
  'sales_invoices',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    kind: invoiceKind('kind').notNull().default('invoice'),
    status: invoiceStatus('status').notNull().default('draft'),
    /**
     * Null while draft. Allocated from the gapless counter at issue, because a
     * gap in an invoice series is a question from the Belastingdienst.
     */
    number: text('number'),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** Totals, denormalised at issue. The lines remain the source of truth. */
    netMinorUnits: bigint('net_minor_units', { mode: 'bigint' }).notNull(),
    taxMinorUnits: bigint('tax_minor_units', { mode: 'bigint' }).notNull(),
    totalMinorUnits: bigint('total_minor_units', { mode: 'bigint' }).notNull(),
    reference: text('reference'),
    /** Set by the buyer. NLCIUS makes it mandatory for many Dutch buyers. */
    buyerReference: text('buyer_reference'),
    notes: text('notes'),
    /** The entry this invoice posted. Null while draft. */
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    /** For a credit note, the invoice it corrects. */
    creditsInvoiceId: uuid('credits_invoice_id'),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    unique('sales_invoices_entity_number').on(table.entityId, table.number),
    index('sales_invoices_contact').on(table.entityId, table.contactId),
    index('sales_invoices_due').on(table.entityId, table.dueDate),
    check('sales_invoices_dates', sql`${table.dueDate} >= ${table.issueDate}`),
    // An issued invoice has a number and an entry; a draft has neither.
    check(
      'sales_invoices_issued_is_complete',
      sql`(${table.status} <> 'issued') or (${table.number} is not null and ${table.journalEntryId} is not null)`,
    ),
  ],
)

export const salesInvoiceLines = klopt.table(
  'sales_invoice_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesInvoices.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    description: text('description').notNull(),
    /** Hours, kilos, units. Six decimals is more than any invoice needs. */
    quantity: numeric('quantity', { precision: 20, scale: 6 }).notNull(),
    unitCode: text('unit_code').notNull().default('EA'),
    unitPriceMinorUnits: bigint('unit_price_minor_units', { mode: 'bigint' }).notNull(),
    revenueAccountId: uuid('revenue_account_id')
      .notNull()
      .references(() => accounts.id),
    taxCodeId: uuid('tax_code_id')
      .notNull()
      .references(() => taxCodes.id),
    netMinorUnits: bigint('net_minor_units', { mode: 'bigint' }).notNull(),
    taxMinorUnits: bigint('tax_minor_units', { mode: 'bigint' }).notNull(),
    ...timestamps,
  },
  (table) => [unique('sales_invoice_lines_number').on(table.invoiceId, table.lineNumber)],
)

/**
 * A delivered document, and what happened to it.
 *
 * "Store the exact bytes sent. The XML is the legal invoice, the PDF is a
 * rendering" (spec 7.5). This is the evidence chain for outbound documents: one
 * row per attempt, with the transport's own id, kept whether or not it
 * succeeded.
 */
export const invoiceDeliveries = klopt.table(
  'invoice_deliveries',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => salesInvoices.id),
    /** `email`, and later `peppol`. */
    channel: text('channel').notNull(),
    recipient: text('recipient').notNull(),
    /** sha256 of the UBL that was sent. The document's identity. */
    documentHash: char('document_hash', { length: 64 }),
    transport: text('transport').notNull(),
    transportMessageId: text('transport_message_id'),
    delivered: boolean('delivered').notNull(),
    failure: text('failure'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('invoice_deliveries_invoice').on(table.invoiceId)],
)
