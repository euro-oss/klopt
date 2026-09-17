import { dimensionKey } from '../../src/ledger/ports.js'
import type {
  AccountRecord,
  AllocateEntryNumberRequest,
  AuditEvent,
  ChainPosition,
  Clock,
  DimensionTypeRecord,
  DimensionValueRecord,
  DomainEvent,
  IdempotencyRecord,
  LedgerRepository,
  LoadPostingContextRequest,
  PeriodRecord,
  PostingContext,
} from '../../src/ledger/ports.js'
import type { PostedJournalEntry } from '../../src/ledger/types.js'

/**
 * An in-memory ledger repository.
 *
 * This exists so the property tests can drive the real `postJournalEntry`
 * rather than a reimplementation of it. A property test that reconstructs the
 * arithmetic it is checking proves only that the test author is consistent with
 * themselves — the first version of these tests did exactly that, and passed
 * while the service had a real rounding bug in it.
 *
 * Not a substitute for the integration tests in @klopt/db: this fake cannot
 * tell you whether the triggers agree with the domain. It is for speed and for
 * cases that are awkward to set up against a real database.
 */

const ACCOUNT_NUMBERS = ['1000', '1100', '1300', '1600', '4000', '8000'] as const

export class FakeLedgerRepository implements LedgerRepository {
  readonly entries: PostedJournalEntry[] = []
  readonly audits: AuditEvent[] = []
  readonly events: DomainEvent[] = []

  private readonly counters = new Map<string, number>()
  private readonly idempotency = new Map<string, IdempotencyRecord>()
  private readonly accounts: Map<string, AccountRecord>
  private readonly dimensionTypes = new Map<string, DimensionTypeRecord>()
  private readonly dimensionValues = new Map<string, DimensionValueRecord>()

  constructor(
    readonly entityId: string,
    readonly functionalCurrency = 'EUR',
  ) {
    this.accounts = new Map(
      ACCOUNT_NUMBERS.map((number) => [
        number,
        {
          id: `acc-${number}`,
          number,
          name: `Account ${number}`,
          type: 'asset' as const,
          normalBalance: 'debit' as const,
          rgsCode: null,
          isBlocked: false,
          requiredDimensionTypeIds: [],
        },
      ]),
    )
  }

  addAccount(account: AccountRecord): void {
    this.accounts.set(account.number, account)
  }

  addDimension(type: DimensionTypeRecord, values: readonly DimensionValueRecord[]): void {
    this.dimensionTypes.set(type.code, type)
    for (const value of values) {
      this.dimensionValues.set(dimensionKey(type.code, value.code), value)
    }
  }

  loadPostingContext(request: LoadPostingContextRequest): Promise<PostingContext | null> {
    if (request.entityId !== this.entityId) return Promise.resolve(null)

    const month = Number(request.bookingDate.slice(5, 7))
    const year = request.bookingDate.slice(0, 4)
    const period: PeriodRecord | null =
      year === '2026'
        ? {
            id: `period-${String(month)}`,
            sequence: month,
            status: 'open',
            startsOn: `2026-${String(month).padStart(2, '0')}-01`,
            endsOn: `2026-${String(month).padStart(2, '0')}-28`,
            fiscalYearId: 'fy-2026',
            fiscalYearCode: '2026',
          }
        : null

    return Promise.resolve({
      entity: {
        id: this.entityId,
        name: 'Fake BV',
        functionalCurrency: this.functionalCurrency,
        rgsVersion: '3.7',
      },
      journal:
        request.journalCode === 'MEM'
          ? { id: 'journal-mem', code: 'MEM', name: 'Memoriaal', type: 'memoriaal' }
          : null,
      period,
      accountsByNumber: this.accounts,
      dimensionTypesByCode: this.dimensionTypes,
      dimensionValuesByKey: this.dimensionValues,
    })
  }

  allocateEntryNumber(request: AllocateEntryNumberRequest): Promise<number> {
    const key = `${request.entityId}|${request.documentType}|${request.fiscalYearCode}`
    const next = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, next)
    return Promise.resolve(next)
  }

  allocateChainPosition(_entityId: string): Promise<ChainPosition> {
    const last = this.entries.at(-1)
    return Promise.resolve({
      sequence: BigInt(this.entries.length + 1),
      previousHash: last?.hash ?? null,
    })
  }

  findEntryById(entityId: string, entryId: string): Promise<PostedJournalEntry | null> {
    return Promise.resolve(
      this.entries.find((entry) => entry.entityId === entityId && entry.id === entryId) ?? null,
    )
  }

  findReversalOf(entityId: string, entryId: string): Promise<string | null> {
    return Promise.resolve(
      this.entries.find((entry) => entry.entityId === entityId && entry.reversesEntryId === entryId)
        ?.id ?? null,
    )
  }

  insertEntry(entry: PostedJournalEntry): Promise<void> {
    this.entries.push(entry)
    return Promise.resolve()
  }

  applyPeriodBalances(): Promise<void> {
    return Promise.resolve()
  }

  findIdempotencyRecord(entityId: string, key: string): Promise<IdempotencyRecord | null> {
    return Promise.resolve(this.idempotency.get(`${entityId}|${key}`) ?? null)
  }

  recordIdempotency(entityId: string, record: IdempotencyRecord): Promise<void> {
    this.idempotency.set(`${entityId}|${record.key}`, record)
    return Promise.resolve()
  }

  appendAudit(event: AuditEvent): Promise<void> {
    this.audits.push(event)
    return Promise.resolve()
  }

  enqueueEvent(event: DomainEvent): Promise<void> {
    this.events.push(event)
    return Promise.resolve()
  }
}

/** A clock that advances a millisecond per call, so entries never share a timestamp. */
export function fakeClock(start = Date.UTC(2026, 5, 15, 9, 0, 0)): Clock {
  let current = start
  return {
    now: () => {
      current += 1
      return new Date(current)
    },
  }
}
