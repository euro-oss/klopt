import type { CurrencyCode } from '../money.js'

/**
 * Ledger vocabulary. Domain types use `| null` rather than optional properties
 * throughout: an entry's canonical hash has to be a total function of its
 * content, and "absent" and "explicitly null" must not be two different things
 * that hash the same way.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

/** Which side increases the account. Drives report signs, not validation. */
export type NormalBalance = 'debit' | 'credit'

/** Dagboek. */
export type JournalType = 'memoriaal' | 'verkoop' | 'inkoop' | 'bank' | 'kas'

/**
 * `soft_closed` means only an accountant may post — a role question, so it is
 * enforced in the application. `hard_closed` is absolute and is enforced by the
 * database as well, because "including via the API" (spec 6.4) has to survive
 * somebody writing a new API.
 */
export type PeriodStatus = 'open' | 'soft_closed' | 'hard_closed'

export type SubledgerKind = 'customer' | 'supplier' | 'asset' | 'project'

/**
 * Who acted. An agent action records both the agent and the human principal
 * behind its token (spec 10.3): "an AI did it" is not an answer an inspector
 * accepts.
 */
export type ActorKind = 'human' | 'script' | 'agent'

export interface Actor {
  readonly kind: ActorKind
  readonly id: string
  /** For `agent`, the human whose token it is acting under. Null otherwise. */
  readonly principalId: string | null
}

/** A tax-coded line is either the base or the tax. See `vat/return.ts`. */
export type TaxRole = 'base' | 'tax'

export interface DimensionAssignment {
  readonly typeCode: string
  readonly valueCode: string
}

export interface JournalLineInput {
  readonly accountNumber: string
  readonly description: string | null
  /** Exactly one of these is non-zero. Both zero is a meaningless line. */
  readonly debit: bigint
  readonly credit: bigint
  /** Original currency. Defaults to the entity's functional currency. */
  readonly currency: CurrencyCode | null
  /** Required when `currency` differs from the entity's functional currency. */
  readonly exchangeRate: string | null
  readonly exchangeRateSource: string | null
  readonly taxCode: string | null
  /**
   * Whether this line *is* the taxable base or the tax on it (spec 7.2).
   *
   * Required alongside a tax code, because the BTW-aangifte is derived from the
   * journal and a half-tagged line would be dropped from it silently.
   */
  readonly taxRole: TaxRole | null
  readonly taxAmount: bigint | null
  readonly dimensions: readonly DimensionAssignment[]
  readonly subledgerKind: SubledgerKind | null
  readonly subledgerId: string | null
}

export interface PostJournalEntryCommand {
  readonly entityId: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly documentDate: string
  readonly description: string
  readonly sourceDocumentRef: string | null
  /** Set when this entry reverses another. Corrections are reversals (spec 6.2). */
  readonly reversesEntryId: string | null
  readonly lines: readonly JournalLineInput[]
}

export interface PostedJournalLine {
  readonly id: string
  readonly lineNumber: number
  readonly accountId: string
  readonly accountNumber: string
  readonly description: string | null
  readonly debit: bigint
  readonly credit: bigint
  readonly currency: CurrencyCode
  readonly functionalDebit: bigint
  readonly functionalCredit: bigint
  readonly exchangeRate: string | null
  readonly exchangeRateSource: string | null
  readonly taxCode: string | null
  readonly taxRole: TaxRole | null
  readonly taxAmount: bigint | null
  readonly dimensions: readonly ResolvedDimension[]
  readonly subledgerKind: SubledgerKind | null
  readonly subledgerId: string | null
}

export interface ResolvedDimension {
  readonly typeId: string
  readonly typeCode: string
  readonly valueId: string
  readonly valueCode: string
}

export interface PostedJournalEntry {
  readonly id: string
  readonly entityId: string
  readonly journalId: string
  readonly journalCode: string
  readonly fiscalYearId: string
  readonly fiscalYearCode: string
  readonly periodId: string
  readonly periodSequence: number
  readonly entryNumber: number
  /** Per-entity monotonic position in the hash chain. */
  readonly chainSequence: bigint
  readonly bookingDate: string
  readonly documentDate: string
  readonly description: string
  readonly sourceDocumentRef: string | null
  readonly reversesEntryId: string | null
  readonly functionalCurrency: CurrencyCode
  readonly createdAt: string
  readonly actor: Actor
  readonly previousHash: string | null
  readonly hash: string
  readonly lines: readonly PostedJournalLine[]
}
