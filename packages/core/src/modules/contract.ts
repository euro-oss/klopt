import type { Permission } from '../auth/roles.js'
import type { EventType } from '../events/catalogue.js'

/**
 * The module contract (spec 9.5).
 *
 * > A module declares: its tables in its own schema, the domain events it
 * > emits and consumes, its posting rules, and its permissions. Enforce it
 * > from the first module you write, which should be Sales, so the contract is
 * > real and not aspirational.
 *
 * "Real and not aspirational" is the whole of it. A contract nothing checks is
 * a paragraph in a README that stops being true in month six, and everybody
 * finds out when a second module writes to `sales_invoices` because it was
 * quicker than asking.
 *
 * So this is data, and `modules.test.ts` fails the build when it stops
 * matching the code:
 *
 *   - Every table in the database is claimed by exactly one module. A new
 *     table with no owner fails. Two modules claiming the same table fails.
 *   - Every event a module says it emits is in the catalogue.
 *   - Every permission a module names exists.
 *
 * What it deliberately does **not** try to enforce mechanically is that a
 * module only *writes* its own tables. Postgres could do that with per-module
 * roles and it may one day; today it would mean a connection per module and a
 * privilege matrix, which is a lot of machinery to defend a boundary that one
 * grep and one code review already defend. The declaration makes the intent
 * checkable by a human, and the ownership test makes the *map* honest, which
 * is the part that rots.
 *
 * ## Why `core` owns this and not each module
 *
 * A module cannot be trusted to declare itself in a file only it reads. The
 * register below is one list, in one place, that a reviewer can hold in their
 * head — and that a test can compare against the schema.
 */

export interface PostingRule {
  /** The journal it posts into, by code. */
  readonly journal: string
  /** When it posts, in one line. This is documentation with a home. */
  readonly when: string
}

export interface ModuleContract {
  readonly name: string
  /** One line: what this module is for. */
  readonly summary: string
  /**
   * Tables it owns. Owning one means: it defines the shape, it writes the
   * rows, and anybody else reads through its repository rather than the table.
   */
  readonly tables: readonly string[]
  readonly emits: readonly EventType[]
  /** Types it acts on. Empty for a module nothing has asked to react yet. */
  readonly consumes: readonly EventType[]
  /** Every posting is through the one posting API — see spec 9.1. */
  readonly posting: readonly PostingRule[]
  readonly permissions: readonly Permission[]
}

/**
 * The kernel: entities, the journal, accounts, documents, parties.
 *
 * Spec 9.4 calls documents and parties "shared kernels", reused by a future
 * inventory or project module rather than duplicated. They are here rather
 * than in Sales for that reason — Sales *uses* contacts, it does not own them,
 * and a purchase invoice points at the same row.
 */
const kernel: ModuleContract = {
  name: 'kernel',
  summary: 'Administrations, the journal, the chart, dimensions, documents and parties.',
  tables: [
    'entities',
    'fiscal_years',
    'periods',
    'journals',
    'journal_entries',
    'journal_lines',
    'journal_line_dimensions',
    'accounts',
    'account_period_balances',
    'account_dimension_requirements',
    'dimension_types',
    'dimension_values',
    'number_sequences',
    'year_closes',
    'contacts',
    'contact_addresses',
    'documents',
    'document_links',
    'tax_codes',
    'idempotency_keys',
    'audit_log',
    'outbox',
  ],
  emits: ['ledger.entry.posted'],
  consumes: [],
  posting: [
    { journal: 'MEM', when: 'A journal entry somebody typed, and the two halves of a year close.' },
  ],
  permissions: [
    'ledger:read',
    'ledger:post',
    'ledger:post-closed',
    'ledger:close',
    'ledger:configure',
    'ledger:export',
    'ledger:import',
  ],
}

/**
 * Sales, which spec 9.5 names as the module the contract has to be proved
 * against first.
 */
const sales: ModuleContract = {
  name: 'sales',
  summary: 'Customers you invoice, the invoices, their delivery and their chasing.',
  tables: ['sales_invoices', 'sales_invoice_lines', 'invoice_deliveries'],
  emits: ['sales.invoice.issued', 'sales.invoice.sent'],
  consumes: [],
  posting: [
    { journal: 'VRK', when: 'An invoice is issued: debtor against revenue and output VAT.' },
  ],
  permissions: ['ledger:read', 'ledger:draft', 'ledger:post'],
}

const purchase: ModuleContract = {
  name: 'purchase',
  summary: 'What suppliers sent, the inbox it arrived in, and authorising it for payment.',
  tables: [
    'purchase_invoices',
    'purchase_invoice_lines',
    'purchase_invoice_allocations',
    'inbox_items',
    'inbound_sources',
  ],
  emits: ['purchase.invoice.booked', 'purchase.invoice.approved'],
  consumes: [],
  posting: [
    {
      journal: 'INK',
      when: 'A purchase invoice is booked: cost and input VAT against the creditor.',
    },
  ],
  permissions: ['ledger:read', 'ledger:draft', 'ledger:post', 'purchase:approve'],
}

const bank: ModuleContract = {
  name: 'bank',
  summary: 'Statements in, matching them to what is owed, and payment files out.',
  tables: [
    'bank_accounts',
    'bank_statements',
    'bank_transactions',
    'bank_transaction_allocations',
    'bank_match_rules',
    'payment_batches',
    'payment_instructions',
    'payment_instruction_invoices',
  ],
  emits: [],
  consumes: [],
  posting: [
    { journal: 'BNK', when: 'A bank line is matched: the bank account against what it settles.' },
  ],
  permissions: ['ledger:read', 'ledger:post', 'payments:prepare', 'payments:approve'],
}

const vat: ModuleContract = {
  name: 'vat',
  summary: 'The BTW-aangifte and the ICP-opgaaf, derived from the journal rather than tallied.',
  tables: ['vat_filings', 'filing_submissions', 'vat_number_checks'],
  emits: ['vat.return.filed'],
  consumes: [],
  posting: [],
  permissions: ['ledger:read', 'ledger:export', 'vat:file'],
}

const compliance: ModuleContract = {
  name: 'compliance',
  summary: 'Bewaarplicht, sealed snapshots and the erasure path.',
  tables: ['sealed_snapshots'],
  emits: [],
  consumes: [],
  posting: [],
  permissions: ['ledger:read', 'ledger:export', 'retention:manage'],
}

/**
 * Access: who may open the books, and what a machine holding a token may do.
 *
 * Its tables are better-auth's plus ours. They are listed rather than exempted
 * because "the ownership map is complete" is the property the test defends,
 * and a category of unowned tables is a hole you could drive a module through.
 */
const access: ModuleContract = {
  name: 'access',
  summary: 'Sessions, memberships, invitations, API tokens and the OAuth clients that get them.',
  tables: [
    'users',
    'sessions',
    'auth_accounts',
    'verifications',
    'auth_rate_limit',
    'entity_members',
    'entity_invitations',
    'api_tokens',
    'oauth_clients',
    'oauth_authorization_codes',
  ],
  emits: [],
  consumes: [],
  posting: [],
  permissions: ['tokens:manage', 'members:manage', 'entity:create'],
}

/**
 * The platform seam itself: how anything outside this repository finds out
 * that something happened.
 */
const platform: ModuleContract = {
  name: 'platform',
  summary: 'Webhook subscriptions and their delivery state, over the outbox the kernel writes.',
  tables: ['webhook_endpoints', 'webhook_deliveries'],
  emits: [],
  // The one module that reads the whole stream. Declared rather than implied:
  // it is the reason `consumes` exists on this interface at all.
  consumes: [
    'ledger.entry.posted',
    'sales.invoice.issued',
    'sales.invoice.sent',
    'purchase.invoice.booked',
    'purchase.invoice.approved',
    'vat.return.filed',
  ],
  posting: [],
  permissions: ['tokens:manage'],
}

/** Migrating in from somewhere else (spec 13). */
const migration: ModuleContract = {
  name: 'migration',
  summary: 'Bringing an administration across from Exact Online, documents included.',
  tables: ['exact_connections', 'exact_document_runs', 'exact_attachments'],
  emits: [],
  consumes: [],
  posting: [{ journal: 'MEM', when: 'The opening balance: every open item as one entry.' }],
  permissions: ['ledger:read', 'ledger:configure', 'ledger:import', 'ledger:post'],
}

export const MODULES: readonly ModuleContract[] = [
  kernel,
  sales,
  purchase,
  bank,
  vat,
  compliance,
  access,
  platform,
  migration,
]

/** Which module owns a table, or nothing if the map has a hole in it. */
export function ownerOf(table: string): ModuleContract | undefined {
  return MODULES.find((module) => module.tables.includes(table))
}
