import {
  dimensionKey,
  type AllocateEntryNumberRequest,
  type AuditEvent,
  type ChainPosition,
  type DimensionTypeRecord,
  type DimensionValueRecord,
  type DomainEvent,
  type IdempotencyRecord,
  type LedgerRepository,
  type LoadPostingContextRequest,
  type PostedJournalEntry,
  type PostedJournalLine,
  type PostingContext,
  type AccountRecord,
} from '@klopt/core'
import { uuidv7 } from '@klopt/core'
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { enqueueDomainEvent } from '../outbox.js'
import {
  accountDimensionRequirements,
  accountPeriodBalances,
  accounts,
  auditLog,
  dimensionTypes,
  dimensionValues,
  entities,
  fiscalYears,
  idempotencyKeys,
  journalEntries,
  journalLineDimensions,
  journalLines,
  journals,
  periods,
} from '../schema/index.js'

/**
 * The ledger ports, against Drizzle.
 *
 * Every method assumes it is inside the caller's transaction — see
 * `withLedger` in ../unit-of-work.ts, which is the only sanctioned way to get
 * one of these. Nothing here opens a transaction of its own, because a posting
 * that half-commits is worse than one that fails.
 */
export class DrizzleLedgerRepository implements LedgerRepository {
  constructor(private readonly tx: Transaction) {}

  async loadPostingContext(request: LoadPostingContextRequest): Promise<PostingContext | null> {
    const [entity] = await this.tx
      .select({
        id: entities.id,
        name: entities.name,
        functionalCurrency: entities.functionalCurrency,
        rgsVersion: entities.rgsVersion,
      })
      .from(entities)
      .where(eq(entities.id, request.entityId))
      .limit(1)

    if (entity === undefined) return null

    const [journal] = await this.tx
      .select({
        id: journals.id,
        code: journals.code,
        name: journals.name,
        type: journals.type,
      })
      .from(journals)
      .where(and(eq(journals.entityId, request.entityId), eq(journals.code, request.journalCode)))
      .limit(1)

    const [period] = await this.tx
      .select({
        id: periods.id,
        sequence: periods.sequence,
        status: periods.status,
        startsOn: periods.startsOn,
        endsOn: periods.endsOn,
        fiscalYearId: periods.fiscalYearId,
        fiscalYearCode: fiscalYears.code,
      })
      .from(periods)
      .innerJoin(fiscalYears, eq(fiscalYears.id, periods.fiscalYearId))
      .where(
        and(
          eq(periods.entityId, request.entityId),
          lte(periods.startsOn, request.bookingDate),
          gte(periods.endsOn, request.bookingDate),
        ),
      )
      .limit(1)

    const uniqueAccountNumbers = [...new Set(request.accountNumbers)]
    const accountRows =
      uniqueAccountNumbers.length === 0
        ? []
        : await this.tx
            .select({
              id: accounts.id,
              number: accounts.number,
              name: accounts.name,
              type: accounts.type,
              normalBalance: accounts.normalBalance,
              rgsCode: accounts.rgsCode,
              isBlocked: accounts.isBlocked,
            })
            .from(accounts)
            .where(
              and(
                eq(accounts.entityId, request.entityId),
                inArray(accounts.number, uniqueAccountNumbers),
              ),
            )

    const requirementRows =
      accountRows.length === 0
        ? []
        : await this.tx
            .select({
              accountId: accountDimensionRequirements.accountId,
              dimensionTypeId: accountDimensionRequirements.dimensionTypeId,
            })
            .from(accountDimensionRequirements)
            .where(
              inArray(
                accountDimensionRequirements.accountId,
                accountRows.map((row) => row.id),
              ),
            )

    const requirementsByAccount = new Map<string, string[]>()
    for (const row of requirementRows) {
      const list = requirementsByAccount.get(row.accountId) ?? []
      list.push(row.dimensionTypeId)
      requirementsByAccount.set(row.accountId, list)
    }

    const accountsByNumber = new Map<string, AccountRecord>(
      accountRows.map((row) => [
        row.number,
        { ...row, requiredDimensionTypeIds: requirementsByAccount.get(row.id) ?? [] },
      ]),
    )

    // Requested types plus every type any of these accounts requires: the
    // "missing required dimension" message needs the type's code, not its id.
    const requiredTypeIds = [...new Set(requirementRows.map((row) => row.dimensionTypeId))]
    const requestedTypeCodes = [...new Set(request.dimensionTypeCodes)]

    const typeRows =
      requiredTypeIds.length === 0 && requestedTypeCodes.length === 0
        ? []
        : await this.tx
            .select({
              id: dimensionTypes.id,
              code: dimensionTypes.code,
              name: dimensionTypes.name,
            })
            .from(dimensionTypes)
            .where(
              and(
                eq(dimensionTypes.entityId, request.entityId),
                or(
                  requestedTypeCodes.length > 0
                    ? inArray(dimensionTypes.code, requestedTypeCodes)
                    : undefined,
                  requiredTypeIds.length > 0
                    ? inArray(dimensionTypes.id, requiredTypeIds)
                    : undefined,
                ),
              ),
            )

    const dimensionTypesByCode = new Map<string, DimensionTypeRecord>(
      typeRows.map((row) => [row.code, row]),
    )

    const valueCodes = [...new Set(request.dimensionPairs.map((pair) => pair.valueCode))]
    const valueRows =
      valueCodes.length === 0
        ? []
        : await this.tx
            .select({
              id: dimensionValues.id,
              typeId: dimensionValues.dimensionTypeId,
              typeCode: dimensionTypes.code,
              code: dimensionValues.code,
              isBlocked: dimensionValues.isBlocked,
            })
            .from(dimensionValues)
            .innerJoin(dimensionTypes, eq(dimensionTypes.id, dimensionValues.dimensionTypeId))
            .where(
              and(
                eq(dimensionValues.entityId, request.entityId),
                inArray(dimensionValues.code, valueCodes),
              ),
            )

    const dimensionValuesByKey = new Map<string, DimensionValueRecord>(
      valueRows.map((row) => [dimensionKey(row.typeCode, row.code), row]),
    )

    return {
      entity,
      journal: journal ?? null,
      period: period ?? null,
      accountsByNumber,
      dimensionTypesByCode,
      dimensionValuesByKey,
    }
  }

  async allocateEntryNumber(request: AllocateEntryNumberRequest): Promise<number> {
    const rows = await this.tx.execute<{ allocate_number: string }>(
      sql`select klopt.allocate_number(${request.entityId}::uuid, ${request.documentType}, ${request.fiscalYearCode})`,
    )
    const value = rows[0]?.allocate_number
    if (value === undefined) throw new Error('allocate_number returned nothing')
    return Number(value)
  }

  async allocateChainPosition(entityId: string): Promise<ChainPosition> {
    // Same gapless allocator as document numbers, on a reserved scope. Taking
    // the row lock here is what serialises postings per entity, which a hash
    // chain requires: two entries cannot both be number N.
    const sequence = await this.allocateEntryNumber({
      entityId,
      documentType: '__chain',
      fiscalYearCode: '',
    })

    if (sequence === 1) return { sequence: 1n, previousHash: null }

    const [previous] = await this.tx
      .select({ hash: journalEntries.hash })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.entityId, entityId),
          eq(journalEntries.chainSequence, BigInt(sequence - 1)),
        ),
      )
      .limit(1)

    if (previous === undefined) {
      throw new Error(
        `Chain gap: entity ${entityId} has no entry at sequence ${String(sequence - 1)}.`,
      )
    }

    return { sequence: BigInt(sequence), previousHash: previous.hash }
  }

  async findEntryById(entityId: string, entryId: string): Promise<PostedJournalEntry | null> {
    const [entry] = await this.tx
      .select({
        id: journalEntries.id,
        entityId: journalEntries.entityId,
        journalId: journalEntries.journalId,
        journalCode: journals.code,
        fiscalYearId: journalEntries.fiscalYearId,
        fiscalYearCode: fiscalYears.code,
        periodId: journalEntries.periodId,
        periodSequence: periods.sequence,
        entryNumber: journalEntries.entryNumber,
        chainSequence: journalEntries.chainSequence,
        bookingDate: journalEntries.bookingDate,
        documentDate: journalEntries.documentDate,
        description: journalEntries.description,
        sourceDocumentRef: journalEntries.sourceDocumentRef,
        reversesEntryId: journalEntries.reversesEntryId,
        functionalCurrency: journalEntries.functionalCurrency,
        createdAt: journalEntries.createdAt,
        actorKind: journalEntries.actorKind,
        actorId: journalEntries.actorId,
        actorPrincipalId: journalEntries.actorPrincipalId,
        previousHash: journalEntries.previousHash,
        hash: journalEntries.hash,
      })
      .from(journalEntries)
      .innerJoin(journals, eq(journals.id, journalEntries.journalId))
      .innerJoin(fiscalYears, eq(fiscalYears.id, journalEntries.fiscalYearId))
      .innerJoin(periods, eq(periods.id, journalEntries.periodId))
      .where(and(eq(journalEntries.entityId, entityId), eq(journalEntries.id, entryId)))
      .limit(1)

    if (entry === undefined) return null

    const lines = await this.loadLines([entry.id])
    return hydrateEntry(entry, lines.get(entry.id) ?? [])
  }

  async findReversalOf(entityId: string, entryId: string): Promise<string | null> {
    const [row] = await this.tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(eq(journalEntries.entityId, entityId), eq(journalEntries.reversesEntryId, entryId)),
      )
      .limit(1)

    return row?.id ?? null
  }

  async insertEntry(entry: PostedJournalEntry): Promise<void> {
    await this.tx.insert(journalEntries).values({
      id: entry.id,
      entityId: entry.entityId,
      journalId: entry.journalId,
      fiscalYearId: entry.fiscalYearId,
      periodId: entry.periodId,
      entryNumber: entry.entryNumber,
      chainSequence: entry.chainSequence,
      bookingDate: entry.bookingDate,
      documentDate: entry.documentDate,
      description: entry.description,
      sourceDocumentRef: entry.sourceDocumentRef,
      reversesEntryId: entry.reversesEntryId,
      functionalCurrency: entry.functionalCurrency,
      actorKind: entry.actor.kind,
      actorId: entry.actor.id,
      actorPrincipalId: entry.actor.principalId,
      previousHash: entry.previousHash,
      hash: entry.hash,
      createdAt: new Date(entry.createdAt),
    })

    await this.tx.insert(journalLines).values(
      entry.lines.map((line) => ({
        id: line.id,
        entityId: entry.entityId,
        entryId: entry.id,
        lineNumber: line.lineNumber,
        accountId: line.accountId,
        description: line.description,
        debitMinorUnits: line.debit,
        creditMinorUnits: line.credit,
        currency: line.currency,
        functionalDebitMinorUnits: line.functionalDebit,
        functionalCreditMinorUnits: line.functionalCredit,
        exchangeRate: line.exchangeRate,
        exchangeRateSource: line.exchangeRateSource,
        taxCode: line.taxCode,
        taxRole: line.taxRole,
        taxMinorUnits: line.taxAmount,
        subledgerKind: line.subledgerKind,
        subledgerId: line.subledgerId,
        periodId: entry.periodId,
      })),
    )

    const dimensionRows = entry.lines.flatMap((line) =>
      line.dimensions.map((dimension) => ({
        lineId: line.id,
        dimensionTypeId: dimension.typeId,
        dimensionValueId: dimension.valueId,
        entityId: entry.entityId,
        entryId: entry.id,
      })),
    )

    if (dimensionRows.length > 0) {
      await this.tx.insert(journalLineDimensions).values(dimensionRows)
    }
  }

  async applyPeriodBalances(entry: PostedJournalEntry): Promise<void> {
    // Collapse the entry's lines per (account, currency) first: an entry with
    // ten lines on one account should be one upsert, not ten.
    const totals = new Map<
      string,
      { accountId: string; currency: string; debit: bigint; credit: bigint }
    >()

    for (const line of entry.lines) {
      const key = `${line.accountId}:${line.currency}`
      const current = totals.get(key) ?? {
        accountId: line.accountId,
        currency: line.currency,
        debit: 0n,
        credit: 0n,
      }
      current.debit += line.debit
      current.credit += line.credit
      totals.set(key, current)
    }

    for (const total of totals.values()) {
      await this.tx
        .insert(accountPeriodBalances)
        .values({
          entityId: entry.entityId,
          accountId: total.accountId,
          periodId: entry.periodId,
          currency: total.currency,
          debitMinorUnits: total.debit,
          creditMinorUnits: total.credit,
        })
        .onConflictDoUpdate({
          target: [
            accountPeriodBalances.entityId,
            accountPeriodBalances.accountId,
            accountPeriodBalances.periodId,
            accountPeriodBalances.currency,
          ],
          set: {
            debitMinorUnits: sql`${accountPeriodBalances.debitMinorUnits} + ${total.debit}`,
            creditMinorUnits: sql`${accountPeriodBalances.creditMinorUnits} + ${total.credit}`,
          },
        })
    }
  }

  async findIdempotencyRecord(entityId: string, key: string): Promise<IdempotencyRecord | null> {
    const [row] = await this.tx
      .select({
        key: idempotencyKeys.key,
        operationId: idempotencyKeys.operationId,
        requestHash: idempotencyKeys.requestHash,
        resultId: idempotencyKeys.resultId,
      })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.entityId, entityId), eq(idempotencyKeys.key, key)))
      .limit(1)

    return row ?? null
  }

  async recordIdempotency(entityId: string, record: IdempotencyRecord): Promise<void> {
    await this.tx.insert(idempotencyKeys).values({ entityId, ...record })
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    await this.tx.insert(auditLog).values({
      id: uuidv7(),
      entityId: event.entityId,
      actorKind: event.actor.kind,
      actorId: event.actor.id,
      actorPrincipalId: event.actor.principalId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      before: event.before,
      after: event.after,
      requestId: event.requestId,
      ip: event.ip,
    })
  }

  /** The outbox, which is not the ledger's but is reached through it here. */
  async enqueueEvent(event: DomainEvent): Promise<void> {
    await enqueueDomainEvent(this.tx, event)
  }

  /** Every entry for one entity, ascending, for chain verification. */
  async loadChain(entityId: string): Promise<PostedJournalEntry[]> {
    const rows = await this.tx
      .select({
        id: journalEntries.id,
        entityId: journalEntries.entityId,
        journalId: journalEntries.journalId,
        journalCode: journals.code,
        fiscalYearId: journalEntries.fiscalYearId,
        fiscalYearCode: fiscalYears.code,
        periodId: journalEntries.periodId,
        periodSequence: periods.sequence,
        entryNumber: journalEntries.entryNumber,
        chainSequence: journalEntries.chainSequence,
        bookingDate: journalEntries.bookingDate,
        documentDate: journalEntries.documentDate,
        description: journalEntries.description,
        sourceDocumentRef: journalEntries.sourceDocumentRef,
        reversesEntryId: journalEntries.reversesEntryId,
        functionalCurrency: journalEntries.functionalCurrency,
        createdAt: journalEntries.createdAt,
        actorKind: journalEntries.actorKind,
        actorId: journalEntries.actorId,
        actorPrincipalId: journalEntries.actorPrincipalId,
        previousHash: journalEntries.previousHash,
        hash: journalEntries.hash,
      })
      .from(journalEntries)
      .innerJoin(journals, eq(journals.id, journalEntries.journalId))
      .innerJoin(fiscalYears, eq(fiscalYears.id, journalEntries.fiscalYearId))
      .innerJoin(periods, eq(periods.id, journalEntries.periodId))
      .where(eq(journalEntries.entityId, entityId))
      .orderBy(asc(journalEntries.chainSequence))

    const lines = await this.loadLines(rows.map((row) => row.id))
    return rows.map((row) => hydrateEntry(row, lines.get(row.id) ?? []))
  }

  private async loadLines(entryIds: readonly string[]): Promise<Map<string, PostedJournalLine[]>> {
    const result = new Map<string, PostedJournalLine[]>()
    if (entryIds.length === 0) return result

    const lineRows = await this.tx
      .select({
        id: journalLines.id,
        entryId: journalLines.entryId,
        lineNumber: journalLines.lineNumber,
        accountId: journalLines.accountId,
        accountNumber: accounts.number,
        description: journalLines.description,
        debit: journalLines.debitMinorUnits,
        credit: journalLines.creditMinorUnits,
        currency: journalLines.currency,
        functionalDebit: journalLines.functionalDebitMinorUnits,
        functionalCredit: journalLines.functionalCreditMinorUnits,
        exchangeRate: journalLines.exchangeRate,
        exchangeRateSource: journalLines.exchangeRateSource,
        taxCode: journalLines.taxCode,
        taxRole: journalLines.taxRole,
        taxAmount: journalLines.taxMinorUnits,
        subledgerKind: journalLines.subledgerKind,
        subledgerId: journalLines.subledgerId,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(inArray(journalLines.entryId, [...entryIds]))
      .orderBy(asc(journalLines.lineNumber))

    const dimensionRows = await this.tx
      .select({
        lineId: journalLineDimensions.lineId,
        typeId: journalLineDimensions.dimensionTypeId,
        typeCode: dimensionTypes.code,
        valueId: journalLineDimensions.dimensionValueId,
        valueCode: dimensionValues.code,
      })
      .from(journalLineDimensions)
      .innerJoin(dimensionTypes, eq(dimensionTypes.id, journalLineDimensions.dimensionTypeId))
      .innerJoin(dimensionValues, eq(dimensionValues.id, journalLineDimensions.dimensionValueId))
      .where(inArray(journalLineDimensions.entryId, [...entryIds]))

    const dimensionsByLine = new Map<
      string,
      { typeId: string; typeCode: string; valueId: string; valueCode: string }[]
    >()
    for (const row of dimensionRows) {
      const list = dimensionsByLine.get(row.lineId) ?? []
      list.push({
        typeId: row.typeId,
        typeCode: row.typeCode,
        valueId: row.valueId,
        valueCode: row.valueCode,
      })
      dimensionsByLine.set(row.lineId, list)
    }

    for (const row of lineRows) {
      const list = result.get(row.entryId) ?? []
      list.push({
        id: row.id,
        lineNumber: row.lineNumber,
        accountId: row.accountId,
        accountNumber: row.accountNumber,
        description: row.description,
        debit: row.debit,
        credit: row.credit,
        currency: row.currency,
        functionalDebit: row.functionalDebit,
        functionalCredit: row.functionalCredit,
        // Postgres pads a numeric to its scale, so 1.5 comes back "1.500000000000".
        // The hash was taken over what the caller sent, so normalise it back.
        exchangeRate: normaliseRate(row.exchangeRate),
        exchangeRateSource: row.exchangeRateSource,
        taxCode: row.taxCode,
        taxRole: row.taxRole,
        taxAmount: row.taxAmount,
        dimensions: dimensionsByLine.get(row.id) ?? [],
        subledgerKind: row.subledgerKind,
        subledgerId: row.subledgerId,
      })
      result.set(row.entryId, list)
    }

    return result
  }
}

function normaliseRate(value: string | null): string | null {
  if (value === null) return null
  if (!value.includes('.')) return value
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '' ? '0' : trimmed
}

interface EntryRow {
  id: string
  entityId: string
  journalId: string
  journalCode: string
  fiscalYearId: string
  fiscalYearCode: string
  periodId: string
  periodSequence: number
  entryNumber: number
  chainSequence: bigint
  bookingDate: string
  documentDate: string
  description: string
  sourceDocumentRef: string | null
  reversesEntryId: string | null
  functionalCurrency: string
  createdAt: Date
  actorKind: 'human' | 'script' | 'agent'
  actorId: string
  actorPrincipalId: string | null
  previousHash: string | null
  hash: string
}

function hydrateEntry(row: EntryRow, lines: PostedJournalLine[]): PostedJournalEntry {
  return {
    id: row.id,
    entityId: row.entityId,
    journalId: row.journalId,
    journalCode: row.journalCode,
    fiscalYearId: row.fiscalYearId,
    fiscalYearCode: row.fiscalYearCode,
    periodId: row.periodId,
    periodSequence: row.periodSequence,
    entryNumber: row.entryNumber,
    chainSequence: row.chainSequence,
    bookingDate: row.bookingDate,
    documentDate: row.documentDate,
    description: row.description,
    sourceDocumentRef: row.sourceDocumentRef,
    reversesEntryId: row.reversesEntryId,
    functionalCurrency: row.functionalCurrency,
    createdAt: row.createdAt.toISOString(),
    actor: {
      kind: row.actorKind,
      id: row.actorId,
      principalId: row.actorPrincipalId,
    },
    previousHash: row.previousHash,
    hash: row.hash,
    lines,
  }
}
