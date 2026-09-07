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
import { timestamps } from './columns.js'
import { accounts, entities, journalEntries } from './ledger.js'

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
    openingBalanceMinorUnits: bigint('opening_balance_minor_units', { mode: 'bigint' }).notNull(),
    closingBalanceMinorUnits: bigint('closing_balance_minor_units', { mode: 'bigint' }).notNull(),
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
