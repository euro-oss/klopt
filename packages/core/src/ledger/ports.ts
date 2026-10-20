import type { CurrencyCode } from '../money.js'
import type {
  AccountType,
  Actor,
  JournalType,
  NormalBalance,
  PeriodStatus,
  PostedJournalEntry,
} from './types.js'

/**
 * Ports the ledger needs. Implemented in @klopt/db against Drizzle, and by
 * in-memory fakes in the core tests.
 *
 * Every method here is called inside one transaction. The caller opens it; the
 * domain never does, because "what is a transaction" is a persistence question.
 */

export interface EntityRecord {
  readonly id: string
  readonly name: string
  readonly functionalCurrency: CurrencyCode
  readonly rgsVersion: string | null
}

export interface AccountRecord {
  readonly id: string
  readonly number: string
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: NormalBalance
  readonly rgsCode: string | null
  readonly isBlocked: boolean
  /** Dimension type ids this account refuses to be posted to without. */
  readonly requiredDimensionTypeIds: readonly string[]
}

export interface JournalRecord {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly type: JournalType
}

export interface PeriodRecord {
  readonly id: string
  readonly sequence: number
  readonly status: PeriodStatus
  readonly startsOn: string
  readonly endsOn: string
  readonly fiscalYearId: string
  readonly fiscalYearCode: string
  /** Open/closed status of the boekjaar that owns this period. */
  readonly fiscalYearStatus: 'open' | 'closed'
}

export interface DimensionTypeRecord {
  readonly id: string
  readonly code: string
  readonly name: string
}

export interface DimensionValueRecord {
  readonly id: string
  readonly typeId: string
  readonly typeCode: string
  readonly code: string
  readonly isBlocked: boolean
}

/** Everything the posting rules need, fetched in one round trip. */
export interface PostingContext {
  readonly entity: EntityRecord
  readonly journal: JournalRecord | null
  readonly period: PeriodRecord | null
  readonly accountsByNumber: ReadonlyMap<string, AccountRecord>
  readonly dimensionTypesByCode: ReadonlyMap<string, DimensionTypeRecord>
  /** Keyed by dimensionKey(typeCode, valueCode). */
  readonly dimensionValuesByKey: ReadonlyMap<string, DimensionValueRecord>
}

/** One key format for the dimension lookup map, so both sides agree on it. */
export function dimensionKey(typeCode: string, valueCode: string): string {
  return `${typeCode}\u0000${valueCode}`
}

export interface ChainPosition {
  readonly sequence: bigint
  readonly previousHash: string | null
}

export interface IdempotencyRecord {
  readonly key: string
  readonly operationId: string
  /** Hash of the request body, so a reused key with different content is caught. */
  readonly requestHash: string
  readonly resultId: string
}

export interface AuditEvent {
  readonly entityId: string
  readonly actor: Actor
  readonly action: string
  readonly resourceType: string
  readonly resourceId: string
  readonly before: unknown
  readonly after: unknown
  readonly requestId: string | null
  readonly ip: string | null
}

export interface DomainEvent {
  readonly entityId: string
  readonly type: string
  readonly version: number
  readonly payload: unknown
}

export interface LoadPostingContextRequest {
  readonly entityId: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly accountNumbers: readonly string[]
  readonly dimensionTypeCodes: readonly string[]
  readonly dimensionPairs: readonly { readonly typeCode: string; readonly valueCode: string }[]
}

export interface AllocateEntryNumberRequest {
  readonly entityId: string
  readonly documentType: string
  readonly fiscalYearCode: string
}

export interface LedgerRepository {
  loadPostingContext(request: LoadPostingContextRequest): Promise<PostingContext | null>

  /**
   * Gapless allocation (spec 6.2). Postgres sequences skip under rollback, so
   * this takes a row lock on a counter inside the caller's transaction.
   */
  allocateEntryNumber(request: AllocateEntryNumberRequest): Promise<number>

  /**
   * Reserves this entry's slot in the entity's hash chain and returns the hash
   * it must link to. Serialises postings per entity, which a chain requires by
   * construction.
   */
  allocateChainPosition(entityId: string): Promise<ChainPosition>

  findEntryById(entityId: string, entryId: string): Promise<PostedJournalEntry | null>

  /** Id of the entry that already reverses this one, if any. */
  findReversalOf(entityId: string, entryId: string): Promise<string | null>

  insertEntry(entry: PostedJournalEntry): Promise<void>

  /**
   * Incrementally maintained period balances (spec 12). Reports read these
   * rather than aggregating the journal, which is what keeps a balance sheet
   * sub-second at five million lines.
   */
  applyPeriodBalances(entry: PostedJournalEntry): Promise<void>

  findIdempotencyRecord(entityId: string, key: string): Promise<IdempotencyRecord | null>
  recordIdempotency(entityId: string, record: IdempotencyRecord): Promise<void>

  appendAudit(event: AuditEvent): Promise<void>
  enqueueEvent(event: DomainEvent): Promise<void>
}

export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}
