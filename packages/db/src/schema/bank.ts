import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { timestamps } from './columns.js'
import { accounts, entities, journalEntries } from './ledger.js'
import { contacts, salesInvoices } from './sales.js'

/**
 * Banking (spec 7.4).
 *
 * Three tables and one idea: **a transaction is a fact about the bank, and a
 * journal entry is a fact about the books.** They are linked, not merged. A
 * statement line that has been matched still says exactly what the bank said,
 * because the bank is the authority on its own statement and because unmatching
 * something must not require reconstructing it.
 *
 * "API and file import must produce an identical transaction stream so nothing
 * downstream cares which one is in use" (spec 7.4) — hence no column here
 * records whether a row arrived by file or by feed beyond the statement's
 * `format`, and nothing downstream reads it.
 */

export const bankTransactionStatus = klopt.enum('bank_transaction_status', [
  'unmatched',
  'matched',
  'ignored',
])

export const bankAccounts = klopt.table(
  'bank_accounts',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    iban: text('iban').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    name: text('name').notNull(),
    /**
     * The ledger account this bank account posts to — 1100 in the shipped
     * chart. Nullable because an account is worth recording before it is
     * wired up, and a match refuses without it rather than guessing.
     */
    ledgerAccountId: uuid('ledger_account_id').references(() => accounts.id),
    /**
     * The highest statement sequence number imported.
     *
     * "Detect gaps in statement sequence numbers and warn." This is what the
     * next import is compared against.
     */
    lastSequenceNumber: integer('last_sequence_number'),
    /** `file` until a feed adapter is configured (spec 8, rule 1). */
    feedProvider: text('feed_provider').notNull().default('file'),
    /** Where the feed left off. Opaque to us; the provider defines it. */
    feedCursor: text('feed_cursor'),
    /**
     * When the PSD2 consent lapses.
     *
     * "Consent expiry is a first-class, surfaced state. PSD2 consents lapse and
     * the failure mode today across all incumbents is silence." So it is a
     * column, it is shown, and it is null for a file import because there is
     * nothing to expire.
     */
    consentExpiresAt: timestamp('consent_expires_at', { withTimezone: true, mode: 'date' }),
    /**
     * How to read this bank's CSV export, once somebody has worked it out.
     *
     * There is no CSV standard and every bank invents its own columns, so the
     * layout is configuration rather than code (spec 7.4). Stored per account
     * because that is the grain at which it differs, and stored at all so the
     * second import does not ask again.
     */
    csvMapping: jsonb('csv_mapping'),
    ...timestamps,
  },
  (table) => [unique('bank_accounts_entity_iban').on(table.entityId, table.iban)],
)

export const bankStatements = klopt.table(
  'bank_statements',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id),
    /** `camt.053`, `mt940` or `csv`. */
    format: text('format').notNull(),
    /** The bank's own identifier for the statement. */
    externalId: text('external_id'),
    sequenceNumber: integer('sequence_number'),
    /** Null for a CSV with no balance column. See `BankStatement`. */
    openingBalanceMinorUnits: bigint('opening_balance_minor_units', { mode: 'bigint' }),
    closingBalanceMinorUnits: bigint('closing_balance_minor_units', { mode: 'bigint' }),
    openingDate: date('opening_date').notNull(),
    closingDate: date('closing_date').notNull(),
    /** sha256 of the file, so re-importing the identical file is visible. */
    sourceHash: char('source_hash', { length: 64 }),
    importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('bank_statements_account').on(table.bankAccountId, table.closingDate),
    check('bank_statements_dates', sql`${table.closingDate} >= ${table.openingDate}`),
  ],
)

export const bankTransactions = klopt.table(
  'bank_transactions',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id),
    statementId: uuid('statement_id').references(() => bankStatements.id),
    /**
     * `ref:…` from the bank, or `sha256:…` of the content.
     *
     * The unique index on this is the whole of deduplication: a re-imported
     * file conflicts row by row rather than being detected as a file.
     */
    dedupeKey: text('dedupe_key').notNull(),
    /** Signed. Positive is money in, which the parsers resolve at the edge. */
    amountMinorUnits: bigint('amount_minor_units', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    bookingDate: date('booking_date').notNull(),
    valueDate: date('value_date').notNull(),
    bankReference: text('bank_reference'),
    endToEndId: text('end_to_end_id'),
    counterpartyName: text('counterparty_name'),
    counterpartyIban: text('counterparty_iban'),
    description: text('description').notNull().default(''),
    remittanceReference: text('remittance_reference'),
    transactionCode: text('transaction_code'),
    /** Exactly what the file said. An audit asks, and a reparse needs it. */
    raw: text('raw'),
    status: bankTransactionStatus('status').notNull().default('unmatched'),
    /** The entry this was matched to. Null while unmatched. */
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    unique('bank_transactions_dedupe').on(table.bankAccountId, table.dedupeKey),
    // The matching queue: unmatched, oldest first, per account.
    index('bank_transactions_queue').on(table.entityId, table.status, table.bookingDate),
    index('bank_transactions_counterparty').on(table.entityId, table.counterpartyIban),
  ],
)

/**
 * What a human chose last time (spec 7.4).
 *
 * "Learn from confirmations: store counterparty, description pattern, and the
 * account or contact the human chose, and use it as a rule next time. Learned
 * rules are visible and editable, never a black box."
 *
 * Visible and editable is why this is a table with a `source` column rather
 * than a statistical model: every rule can be listed, explained, switched off
 * and deleted. `times_applied` is what a confidence is built from, and it is
 * also the honest answer to "why did it suggest that".
 *
 * A rule never points at an invoice. An invoice is paid once, so a rule that
 * fired twice on the same one would be a bug rather than a convenience.
 */
export const bankMatchRules = klopt.table(
  'bank_match_rules',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    /** `learned` from a confirmation, or `manual` because somebody wrote it. */
    source: text('source').notNull().default('learned'),
    counterpartyIban: text('counterparty_iban'),
    counterpartyName: text('counterparty_name'),
    descriptionContains: text('description_contains'),
    accountId: uuid('account_id').references(() => accounts.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    timesApplied: integer('times_applied').notNull().default(0),
    lastAppliedAt: timestamp('last_applied_at', { withTimezone: true, mode: 'date' }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index('bank_match_rules_entity').on(table.entityId, table.isActive),
    /**
     * One rule per condition set, so learning the same thing twice bumps the
     * counter instead of growing a pile of duplicates nobody can read.
     *
     * `NULLS NOT DISTINCT` is load-bearing: a rule normally has one condition
     * and two nulls, and under the default `NULLS DISTINCT` two such rows never
     * conflict — so every confirmation would insert a new rule and
     * `times_applied` would never leave 1. Which is exactly what it did.
     */
    unique('bank_match_rules_conditions')
      .on(table.entityId, table.counterpartyIban, table.counterpartyName, table.descriptionContains)
      .nullsNotDistinct(),
  ],
)

/**
 * What a bank line paid for.
 *
 * A separate table rather than a column, because one payment settles several
 * invoices and one invoice is settled by several payments — spec 7.4 asks for
 * both, and the allocation is the only place that can be true.
 *
 * This is also what finally makes "outstanding" mean something: an invoice's
 * outstanding amount is its total less the allocations against it. Until this
 * table existed, the dunning list could only say "issued and not cancelled".
 */
export const bankTransactionAllocations = klopt.table(
  'bank_transaction_allocations',
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
      .references(() => salesInvoices.id),
    /** Unsigned: the direction is the transaction's. */
    amountMinorUnits: bigint('amount_minor_units', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('bank_allocations_unique').on(table.transactionId, table.invoiceId),
    index('bank_allocations_invoice').on(table.invoiceId),
    check('bank_allocations_positive', sql`${table.amountMinorUnits} > 0`),
  ],
)

/**
 * A payment batch, and the two people it takes (spec 7.4).
 *
 * "SEPA pain.001 batch export for supplier payments, with a two-person approval
 * flow." The state and the two user columns are that flow: who submitted it and
 * who approved it are recorded, and the domain refuses when they are the same
 * person.
 *
 * Instructions are editable only while the batch is a draft. Once submitted
 * they are frozen, because an approval has to mean the approver saw what will
 * be sent — an approver who approves a batch that then changes has approved
 * nothing.
 */
export const paymentBatchState = klopt.enum('payment_batch_state', [
  'draft',
  'submitted',
  'approved',
  'exported',
  'rejected',
])

export const paymentBatches = klopt.table(
  'payment_batches',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    /** What the bank will see as the message id. Unique per entity. */
    reference: text('reference').notNull(),
    state: paymentBatchState('state').notNull().default('draft'),
    /** The account the money leaves from. */
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id),
    requestedExecutionDate: date('requested_execution_date').notNull(),
    /**
     * Who, as an **actor id** rather than a user id.
     *
     * No foreign key, for the same reason `audit_log.actor_id` has none: an
     * actor is not always a row in `users`. A scoped API token carries its own
     * actor id, and a human working through the API is a legitimate caller — so
     * a foreign key here turns "submit this batch with a token" into a 500,
     * which is exactly what it did until an HTTP walk-through found it.
     *
     * The two-person rule compares these values, which is right whatever kind
     * of actor they name.
     */
    submittedBy: text('submitted_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    rejectedBy: text('rejected_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'date' }),
    rejectionReason: text('rejection_reason'),
    exportedAt: timestamp('exported_at', { withTimezone: true, mode: 'date' }),
    /** sha256 of the file that was handed over. The evidence chain (spec 8). */
    exportedHash: char('exported_hash', { length: 64 }),
    ...timestamps,
  },
  (table) => [
    unique('payment_batches_entity_reference').on(table.entityId, table.reference),
    index('payment_batches_state').on(table.entityId, table.state),
    /**
     * The two-person rule, at the storage layer as well as in the domain.
     *
     * Belt and braces on purpose: this is the one table whose contents move
     * money out of the building, and a check constraint survives a refactor
     * that loses a call to `nextState`.
     */
    check(
      'payment_batches_two_person',
      sql`${table.approvedBy} is null or ${table.submittedBy} is null or ${table.approvedBy} <> ${table.submittedBy}`,
    ),
  ],
)

export const paymentInstructions = klopt.table(
  'payment_instructions',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => paymentBatches.id, { onDelete: 'cascade' }),
    /** The reference the payee sees, and what a returned payment quotes. */
    endToEndId: text('end_to_end_id').notNull(),
    /** Who is being paid, when they are a known contact. */
    contactId: uuid('contact_id').references(() => contacts.id),
    creditorName: text('creditor_name').notNull(),
    creditorIban: text('creditor_iban').notNull(),
    creditorBic: text('creditor_bic'),
    amountMinorUnits: bigint('amount_minor_units', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    remittanceInformation: text('remittance_information').notNull().default(''),
    remittanceReference: text('remittance_reference'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // A bank may read two identical end-to-end ids as a duplicate payment.
    unique('payment_instructions_end_to_end').on(table.batchId, table.endToEndId),
    index('payment_instructions_batch').on(table.batchId),
    check('payment_instructions_positive', sql`${table.amountMinorUnits} > 0`),
  ],
)
