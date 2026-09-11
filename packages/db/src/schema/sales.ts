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

/** Spec 7.2's tax code rule. See packages/core/src/vat/tax-code.ts. */
export const taxScope = klopt.enum('tax_scope', [
  'domestic',
  'intra_community_supply',
  'intra_community_acquisition',
  'import',
  'export',
  'private_use',
  'exempt',
  'out_of_scope',
])
export const reverseCharge = klopt.enum('reverse_charge', ['none', 'domestic', 'import_article_23'])
export const deductibility = klopt.enum('deductibility', ['full', 'pro_rata', 'none'])
export const supplyKind = klopt.enum('supply_kind', ['goods', 'services', 'not_applicable'])

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
    /** BT-49, the buyer's electronic address. See the seller's, on `entities`. */
    electronicAddress: text('electronic_address'),
    electronicAddressScheme: text('electronic_address_scheme'),
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
     * K intra-community, G export, O out of scope.
     *
     * `text`, not `char(2)`: the codes are one *or* two characters, and
     * `character(n)` blank-pads, so `S` came back as `'S '` and every UBL
     * generated from the database carried an invalid category code. See
     * migration 0014.
     */
    ublCategory: text('ubl_category').notNull().default('S'),
    /**
     * Which box on the BTW-aangifte the base and the VAT are declared in. Null
     * where the form has no box: a domestic purchase declares VAT in 5b and no
     * base anywhere.
     */
    baseRubriek: text('base_rubriek'),
    vatRubriek: text('vat_rubriek'),
    scope: taxScope('scope').notNull().default('domestic'),
    reverseCharge: reverseCharge('reverse_charge').notNull().default('none'),
    deductibility: deductibility('deductibility').notNull().default('full'),
    proRataBasisPoints: integer('pro_rata_basis_points'),
    /** The ICP opgaaf reports goods and services separately. */
    supplyKind: supplyKind('supply_kind').notNull().default('not_applicable'),
    /** The input code carrying the deduction half of a reverse charge. */
    deductionCode: text('deduction_code'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    ...timestamps,
  },
  (table) => [
    // A rate change is a new row, never an update: old periods must keep
    // reporting at the old rate. So a code is unique per validity window.
    unique('tax_codes_entity_code_from').on(table.entityId, table.code, table.validFrom),
    check('tax_codes_rate_range', sql`${table.rateBasisPoints} between 0 and 10000`),
    check('tax_codes_ubl_category_shape', sql`${table.ublCategory} ~ '^[A-Z]{1,2}$'`),
    check(
      'tax_codes_pro_rata_share',
      sql`(${table.deductibility} = 'pro_rata') = (${table.proRataBasisPoints} is not null)`,
    ),
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

    /**
     * The buyer as they were at issue, not as `contacts` has them today.
     *
     * An invoice has to name its buyer for seven years, and the contact row is
     * current master data — it changes when somebody moves, and it is the row
     * an erasure request acts on. Taken at issue, with the number and the
     * entry. See migration 0026.
     */
    buyerName: text('buyer_name'),
    buyerLegalName: text('buyer_legal_name'),
    buyerVatNumber: text('buyer_vat_number'),
    buyerKvkNumber: text('buyer_kvk_number'),
    buyerCountryCode: char('buyer_country_code', { length: 2 }),
    buyerStreet: text('buyer_street'),
    buyerHouseNumber: text('buyer_house_number'),
    buyerPostalCode: text('buyer_postal_code'),
    buyerCity: text('buyer_city'),
    buyerElectronicAddress: text('buyer_electronic_address'),
    buyerElectronicAddressScheme: text('buyer_electronic_address_scheme'),
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
    check(
      'sales_invoices_issued_names_buyer',
      sql`${table.status} = 'draft' or ${table.buyerName} is not null`,
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
    /**
     * `invoice` or `reminder`. The same table carries both because they are the
     * same act — a document going to a customer — and because the dunning stage
     * an invoice has reached is a fact about its delivery history, not a column
     * on the invoice that has to be kept in step with it.
     */
    purpose: text('purpose').notNull().default('invoice'),
    /** 1, 2, 3… for a reminder. Null for the invoice itself. */
    dunningStage: smallint('dunning_stage'),
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
