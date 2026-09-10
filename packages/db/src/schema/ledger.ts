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
  numeric,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { timestamps } from './columns.js'

/**
 * The ledger.
 *
 * Two conventions run through all of it:
 *
 * - **Money is two columns.** `*_minor_units bigint` plus a currency, and
 *   `mode: 'bigint'` on every one of them. Drizzle's default number mode hands
 *   back a JS float, which is how a cent goes missing.
 * - **Every tenant-scoped table carries `entity_id` as a real column**, even
 *   where it is reachable through a parent. Row-level security policies are
 *   then additive rather than a rewrite (ADR 0006), and the balance and hash
 *   constraint triggers can check without a join.
 *
 * The append-only guarantee, the balance check and the chain linkage are
 * enforced by triggers in migrations/0001_ledger_guards.sql. Drizzle cannot
 * express them, and they are not optional.
 */

export const accountType = klopt.enum('account_type', [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
])

export const normalBalance = klopt.enum('normal_balance', ['debit', 'credit'])

/** Dagboek. */
export const journalType = klopt.enum('journal_type', [
  'memoriaal',
  'verkoop',
  'inkoop',
  'bank',
  'kas',
])

export const periodStatus = klopt.enum('period_status', ['open', 'soft_closed', 'hard_closed'])

export const fiscalYearStatus = klopt.enum('fiscal_year_status', ['open', 'closed'])

export const subledgerKind = klopt.enum('subledger_kind', [
  'customer',
  'supplier',
  'asset',
  'project',
])

export const taxRole = klopt.enum('tax_role', ['base', 'tax'])
export const vatPeriodKind = klopt.enum('vat_period_kind', ['monthly', 'quarterly', 'annual'])

export const actorKind = klopt.enum('actor_kind', ['human', 'script', 'agent'])

export const vatRoundingPolicy = klopt.enum('vat_rounding_policy', ['per_invoice', 'per_line'])

export const entities = klopt.table(
  'entities',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    legalName: text('legal_name').notNull(),
    kvkNumber: text('kvk_number'),
    vatNumber: text('vat_number'),
    functionalCurrency: char('functional_currency', { length: 3 }).notNull().default('EUR'),
    /** A boekjaar need not be a calendar year (spec 6.4). */
    fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1),
    rgsVersion: text('rgs_version'),
    rgsVariant: text('rgs_variant').notNull().default('mkb'),
    vatRounding: vatRoundingPolicy('vat_rounding').notNull().default('per_invoice'),
    /**
     * How often this entity files (spec 7.2). Quarterly by default: it is what
     * the Belastingdienst assigns to almost every new MKB registration.
     */
    vatPeriodKind: vatPeriodKind('vat_period_kind').notNull().default('quarterly'),
    /** The recoverable share for pro rata input VAT, revised annually. */
    vatProRataBasisPoints: integer('vat_pro_rata_basis_points'),
    /**
     * Where bank charges are split off to when a payment arrives short (spec
     * 7.4).
     *
     * A setting rather than a constant: `4900` is Algemene kosten in the chart
     * we ship and means nothing in a chart somebody brought with them. Null
     * means charge splitting is not offered, which is honest — the alternative
     * is a suggestion that cannot be posted.
     */
    bankChargesAccountNumber: text('bank_charges_account_number'),

    /**
     * Who the seller is, on paper (spec 7.5).
     *
     * Nullable, because an administration is usable as a shadow ledger long
     * before anybody invoices out of it — and refusing to create one until an
     * address is typed would put a form in front of the thing people came for.
     * The UBL generator refuses instead, naming the BT number of each field it
     * is missing, which is the moment they actually matter.
     */
    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    countryCode: char('country_code', { length: 2 }).notNull().default('NL'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    iban: text('iban'),
    bic: text('bic'),
    /**
     * BT-34, the seller's electronic address, and the scheme it is in: `0106`
     * for a KvK number, `0190` for an OIN, `9944` for a VAT number. Peppol
     * requires it even when the transport is email, because the identifier is
     * what makes the invoice addressable at all.
     */
    electronicAddress: text('electronic_address'),
    electronicAddressScheme: text('electronic_address_scheme'),
    /**
     * A hold over the whole administration (spec 7.6).
     *
     * Separate from the per-document flag and checked first: a firm under
     * investigation should not have to set a flag on forty thousand rows, and
     * lifting it should be one deliberate act rather than forty thousand.
     */
    legalHold: boolean('legal_hold').notNull().default(false),
    legalHoldReason: text('legal_hold_reason'),
    ...timestamps,
  },
  (table) => [
    check(
      'entities_fiscal_year_start_month_range',
      sql`${table.fiscalYearStartMonth} between 1 and 12`,
    ),
  ],
)

export const fiscalYears = klopt.table(
  'fiscal_years',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    code: text('code').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: fiscalYearStatus('status').notNull().default('open'),
    ...timestamps,
  },
  (table) => [
    unique('fiscal_years_entity_code').on(table.entityId, table.code),
    check('fiscal_years_range', sql`${table.endsOn} > ${table.startsOn}`),
  ],
)

export const periods = klopt.table(
  'periods',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    sequence: smallint('sequence').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: periodStatus('status').notNull().default('open'),
    ...timestamps,
  },
  (table) => [
    unique('periods_year_sequence').on(table.fiscalYearId, table.sequence),
    check('periods_range', sql`${table.endsOn} >= ${table.startsOn}`),
    // Resolving a booking date to its period is on the hot path of every post.
    index('periods_entity_dates').on(table.entityId, table.startsOn, table.endsOn),
  ],
)

export const accounts = klopt.table(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    number: text('number').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
    normalBalance: normalBalance('normal_balance').notNull(),
    /** RGS reference code. Nullable, and unmapped accounts are a dashboard metric. */
    rgsCode: text('rgs_code'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    /** Plain text until the tax code engine lands in M3. */
    defaultTaxCode: text('default_tax_code'),
    ...timestamps,
  },
  (table) => [
    unique('accounts_entity_number').on(table.entityId, table.number),
    index('accounts_entity_rgs').on(table.entityId, table.rgsCode),
  ],
)

export const dimensionTypes = klopt.table(
  'dimension_types',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (table) => [unique('dimension_types_entity_code').on(table.entityId, table.code)],
)

export const dimensionValues = klopt.table(
  'dimension_values',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    dimensionTypeId: uuid('dimension_type_id')
      .notNull()
      .references(() => dimensionTypes.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isBlocked: boolean('is_blocked').notNull().default(false),
    ...timestamps,
  },
  (table) => [unique('dimension_values_type_code').on(table.dimensionTypeId, table.code)],
)

/** "Any posting to fuel cost must carry a vehicle" (spec 6.3). */
export const accountDimensionRequirements = klopt.table(
  'account_dimension_requirements',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    dimensionTypeId: uuid('dimension_type_id')
      .notNull()
      .references(() => dimensionTypes.id),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.dimensionTypeId] })],
)

export const journals = klopt.table(
  'journals',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: journalType('type').notNull(),
    ...timestamps,
  },
  (table) => [unique('journals_entity_code').on(table.entityId, table.code)],
)

/**
 * Gapless numbering (spec 6.2). A Postgres sequence is not gapless — a
 * rollback burns its value — so numbers come from this table under a row lock
 * taken inside the posting transaction.
 *
 * `document_type` is the scope, e.g. `journal:VRK` or `sales_invoice`.
 * `__chain` is the per-entity hash chain position, which uses the same
 * mechanism because it needs the same guarantee.
 */
export const numberSequences = klopt.table(
  'number_sequences',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    documentType: text('document_type').notNull(),
    fiscalYearCode: text('fiscal_year_code').notNull(),
    // A raw SQL default: drizzle-kit cannot serialise a JS bigint literal.
    nextValue: bigint('next_value', { mode: 'bigint' })
      .notNull()
      .default(sql`1`),
  },
  (table) => [primaryKey({ columns: [table.entityId, table.documentType, table.fiscalYearCode] })],
)

export const journalEntries = klopt.table(
  'journal_entries',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journals.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    entryNumber: bigint('entry_number', { mode: 'number' }).notNull(),
    /** Position in the entity's hash chain. Dense, from 1. */
    chainSequence: bigint('chain_sequence', { mode: 'bigint' }).notNull(),
    bookingDate: date('booking_date').notNull(),
    documentDate: date('document_date').notNull(),
    description: text('description').notNull(),
    sourceDocumentRef: text('source_document_ref'),
    reversesEntryId: uuid('reverses_entry_id'),
    functionalCurrency: char('functional_currency', { length: 3 }).notNull(),
    actorKind: actorKind('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    /** For an agent, the human behind its token (spec 10.3). */
    actorPrincipalId: text('actor_principal_id'),
    previousHash: char('previous_hash', { length: 64 }),
    hash: char('hash', { length: 64 }).notNull(),
    // mode 'date', not 'string': the hash covers an ISO-8601 timestamp, and
    // Postgres renders timestamptz as `2026-09-04 07:00:00+00`. Round-tripping
    // through a Date is what keeps the recomputed hash equal to the stored one.
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    unique('journal_entries_entity_chain').on(table.entityId, table.chainSequence),
    unique('journal_entries_number').on(
      table.entityId,
      table.journalId,
      table.fiscalYearId,
      table.entryNumber,
    ),
    // At most one reversal per entry. A partial unique index, because most
    // entries reverse nothing.
    uniqueIndex('journal_entries_one_reversal')
      .on(table.entityId, table.reversesEntryId)
      .where(sql`reverses_entry_id is not null`),
    index('journal_entries_period').on(table.entityId, table.periodId),
    index('journal_entries_booking_date').on(table.entityId, table.bookingDate),
  ],
)

export const journalLines = klopt.table(
  'journal_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id),
    lineNumber: integer('line_number').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    description: text('description'),
    debitMinorUnits: bigint('debit_minor_units', { mode: 'bigint' }).notNull(),
    creditMinorUnits: bigint('credit_minor_units', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    functionalDebitMinorUnits: bigint('functional_debit_minor_units', {
      mode: 'bigint',
    }).notNull(),
    functionalCreditMinorUnits: bigint('functional_credit_minor_units', {
      mode: 'bigint',
    }).notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 24, scale: 12 }),
    exchangeRateSource: text('exchange_rate_source'),
    taxCode: text('tax_code'),
    taxMinorUnits: bigint('tax_minor_units', { mode: 'bigint' }),
    /**
     * Whether this line *is* the taxable base or the tax on it.
     *
     * The BTW-aangifte is derived from the journal, and rubriek 1a wants the
     * omzet as well as the VAT. Inferring which is which from the accounts
     * breaks on the first invoice putting 21% and 9% on one revenue account, so
     * the line says so. Set together with the tax code or not at all -- a
     * half-tagged line would be silently dropped from the return, which a check
     * constraint refuses.
     */
    taxRole: taxRole('tax_role'),
    subledgerKind: subledgerKind('subledger_kind'),
    subledgerId: uuid('subledger_id'),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
  },
  (table) => [
    unique('journal_lines_entry_line').on(table.entryId, table.lineNumber),
    check(
      'journal_lines_tax_role_needs_code',
      sql`(${table.taxCode} is null) = (${table.taxRole} is null)`,
    ),
    check(
      'journal_lines_single_side',
      sql`(${table.debitMinorUnits} = 0) <> (${table.creditMinorUnits} = 0)`,
    ),
    check(
      'journal_lines_unsigned',
      sql`${table.debitMinorUnits} >= 0 and ${table.creditMinorUnits} >= 0`,
    ),
    check(
      'journal_lines_rate_pairing',
      sql`(${table.exchangeRate} is null) = (${table.exchangeRateSource} is null)`,
    ),
    check(
      'journal_lines_subledger_pairing',
      sql`(${table.subledgerKind} is null) = (${table.subledgerId} is null)`,
    ),
    index('journal_lines_account_period').on(table.entityId, table.accountId, table.periodId),
    index('journal_lines_subledger')
      .on(table.entityId, table.subledgerKind, table.subledgerId)
      .where(sql`subledger_id is not null`),
  ],
)

export const journalLineDimensions = klopt.table(
  'journal_line_dimensions',
  {
    lineId: uuid('line_id')
      .notNull()
      .references(() => journalLines.id),
    dimensionTypeId: uuid('dimension_type_id')
      .notNull()
      .references(() => dimensionTypes.id),
    dimensionValueId: uuid('dimension_value_id')
      .notNull()
      .references(() => dimensionValues.id),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id),
  },
  (table) => [
    // One value per dimension type per line: a line is in one region, not two.
    primaryKey({ columns: [table.lineId, table.dimensionTypeId] }),
    index('journal_line_dimensions_value').on(table.entityId, table.dimensionValueId),
  ],
)

/**
 * Incrementally maintained balances (spec 12). Reports read these instead of
 * aggregating five million journal lines, which is the whole reason a balance
 * sheet can be sub-second.
 *
 * Maintained in the posting transaction, never by a rebuild job — a rebuild
 * job means a window in which the reports and the journal disagree. A
 * reconciliation check compares the two on a schedule and alerts on drift.
 */
export const accountPeriodBalances = klopt.table(
  'account_period_balances',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    currency: char('currency', { length: 3 }).notNull(),
    debitMinorUnits: bigint('debit_minor_units', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    creditMinorUnits: bigint('credit_minor_units', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.accountId, table.periodId, table.currency] }),
  ],
)

/**
 * Idempotency (spec 10.2). Every write carries a client key; a retry returns
 * the original result instead of posting again.
 */
export const idempotencyKeys = klopt.table(
  'idempotency_keys',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    key: text('key').notNull(),
    operationId: text('operation_id').notNull(),
    /** Catches the same key reused for a different body. */
    requestHash: char('request_hash', { length: 64 }).notNull(),
    resultId: uuid('result_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.entityId, table.key] })],
)

/**
 * Audit log (spec 7.6). Append-only, covering API calls as well as UI actions,
 * and distinguishing human from script from agent.
 */
export const auditLog = klopt.table(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id').references(() => entities.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    actorKind: actorKind('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    actorPrincipalId: text('actor_principal_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    ip: text('ip'),
  },
  (table) => [
    index('audit_log_entity_time').on(table.entityId, table.occurredAt),
    index('audit_log_resource').on(table.resourceType, table.resourceId),
  ],
)

/**
 * Transactional outbox (spec 9.3). The event is written in the same
 * transaction as the state change it describes, which is the only way the
 * at-least-once guarantee actually holds. Webhooks, search indexing and future
 * modules are all consumers.
 */
export const outbox = klopt.table(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('outbox_unpublished')
      .on(table.occurredAt)
      .where(sql`published_at is null`),
  ],
)

/**
 * Scoped API tokens (spec 14). Only the hash is stored; see
 * migrations/0002_api_tokens.sql.
 */
export const apiTokens = klopt.table(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    name: text('name').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    permissions: text('permissions').array().notNull(),
    actorKind: actorKind('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    principalId: text('principal_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /**
     * The OAuth client that obtained this token, when one did.
     *
     * So Toegang can say "Claude" rather than "a token", and so revoking a
     * client can revoke what it holds.
     */
    oauthClientId: text('oauth_client_id'),
  },
  (table) => [index('api_tokens_entity').on(table.entityId)],
)

/**
 * A year close (spec 6.4). Two ordinary journal entries plus the record that
 * they were a close, so it can be shown, audited and reversed.
 */
export const yearCloses = klopt.table(
  'year_closes',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    appropriationEntryId: uuid('appropriation_entry_id').references(() => journalEntries.id),
    openingEntryId: uuid('opening_entry_id').references(() => journalEntries.id),
    resultMinorUnits: bigint('result_minor_units', { mode: 'bigint' }).notNull(),
    resultCurrency: char('result_currency', { length: 3 }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    closedBy: text('closed_by').notNull(),
    reversedAt: timestamp('reversed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('year_closes_one_open_per_year')
      .on(table.fiscalYearId)
      .where(sql`reversed_at is null`),
  ],
)

/**
 * OAuth clients, registered dynamically (RFC 7591).
 *
 * Public clients only: an MCP client running on somebody's laptop cannot keep
 * a secret, so there is none. PKCE is what authenticates the redemption.
 */
export const oauthClients = klopt.table('oauth_clients', {
  id: uuid('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientName: text('client_name').notNull(),
  /** Exact-match list. A prefix match here is an open redirect. */
  redirectUris: text('redirect_uris').array().notNull(),
  registeredBy: text('registered_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
})

/** An authorization code, hashed, single-use and short-lived. */
export const oauthAuthorizationCodes = klopt.table('oauth_authorization_codes', {
  id: uuid('id').primaryKey(),
  codeHash: char('code_hash', { length: 64 }).notNull().unique(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  resource: text('resource'),
  scope: text('scope').array().notNull(),
  userId: text('user_id').notNull(),
  entityId: uuid('entity_id')
    .notNull()
    .references(() => entities.id),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
