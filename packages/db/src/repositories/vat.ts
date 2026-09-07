import {
  buildVatReturn,
  uuidv7,
  type TaxCodeRule,
  type VatJournalLine,
  type VatReturn,
} from '@klopt/core'
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import {
  accounts,
  entities,
  journalEntries,
  journalLines,
  journals,
  periods,
} from '../schema/ledger.js'
import { taxCodes } from '../schema/sales.js'
import { vatFilings } from '../schema/vat.js'

/**
 * Reading the journal for the BTW-aangifte.
 *
 * Every line in the period that carries a tax code, plus every movement on a
 * VAT control account whether tagged or not. The second half is what makes the
 * reconciliation possible: a control account that moved without a tax code is
 * either a payment to the Belastingdienst or somebody's hand-typed correction,
 * and the return has to say which lines it could not account for.
 *
 * Deliberately not reading `account_period_balances`. The maintained balances
 * are per account and per period, which cannot answer "which lines produced
 * rubriek 1a" — and the reconciliation report is required to answer exactly
 * that (spec 7.2).
 */

export interface VatPeriodQuery {
  readonly entityId: string
  readonly from: string
  readonly to: string
}

export class VatRepository {
  constructor(private readonly tx: Transaction) {}

  /** The tax codes configured for an entity, as rules. */
  async rules(entityId: string): Promise<TaxCodeRule[]> {
    const rows = await this.tx
      .select({
        code: taxCodes.code,
        description: taxCodes.description,
        rateBasisPoints: taxCodes.rateBasisPoints,
        validFrom: taxCodes.validFrom,
        validTo: taxCodes.validTo,
        direction: taxCodes.direction,
        baseRubriek: taxCodes.baseRubriek,
        vatRubriek: taxCodes.vatRubriek,
        reverseCharge: taxCodes.reverseCharge,
        scope: taxCodes.scope,
        deductibility: taxCodes.deductibility,
        proRataBasisPoints: taxCodes.proRataBasisPoints,
        supplyKind: taxCodes.supplyKind,
        ublCategory: taxCodes.ublCategory,
        deductionCode: taxCodes.deductionCode,
      })
      .from(taxCodes)
      .where(eq(taxCodes.entityId, entityId))
      // Newest window first, so `ruleInForce` finding the first match finds the
      // one that superseded the others.
      .orderBy(asc(taxCodes.code), desc(taxCodes.validFrom))

    return rows.map((row) => ({
      code: row.code,
      description: row.description,
      rateBasisPoints: row.rateBasisPoints,
      validFrom: row.validFrom,
      validTo: row.validTo,
      direction: row.direction,
      baseRubriek: row.baseRubriek,
      vatRubriek: row.vatRubriek,
      reverseCharge: row.reverseCharge,
      scope: row.scope,
      deductibility: row.deductibility,
      proRataBasisPoints: row.proRataBasisPoints,
      supplyKind: row.supplyKind,
      ublCategory: row.ublCategory,
      deductionCode: row.deductionCode,
    }))
  }

  /** The accounts VAT is posted to, from the tax codes themselves. */
  async controlAccountNumbers(entityId: string): Promise<string[]> {
    const rows = await this.tx
      .selectDistinct({ number: accounts.number })
      .from(taxCodes)
      .innerJoin(accounts, eq(accounts.id, taxCodes.accountId))
      .where(eq(taxCodes.entityId, entityId))
      .orderBy(asc(accounts.number))

    return rows.map((row) => row.number)
  }

  async periodLines(query: VatPeriodQuery): Promise<VatJournalLine[]> {
    const controlAccounts = await this.controlAccountNumbers(query.entityId)

    const rows = await this.tx
      .select({
        entryId: journalEntries.id,
        entryNumber: journalEntries.entryNumber,
        journalCode: journals.code,
        bookingDate: journalEntries.bookingDate,
        lineNumber: journalLines.lineNumber,
        accountNumber: accounts.number,
        accountName: accounts.name,
        description: journalLines.description,
        taxCode: journalLines.taxCode,
        taxRole: journalLines.taxRole,
        debit: journalLines.functionalDebitMinorUnits,
        credit: journalLines.functionalCreditMinorUnits,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .innerJoin(journals, eq(journals.id, journalEntries.journalId))
      .where(
        and(
          eq(journalEntries.entityId, query.entityId),
          gte(journalEntries.bookingDate, query.from),
          lte(journalEntries.bookingDate, query.to),
          controlAccounts.length === 0
            ? isNotNull(journalLines.taxCode)
            : or(isNotNull(journalLines.taxCode), inArray(accounts.number, controlAccounts)),
        ),
      )
      .orderBy(
        asc(journalEntries.bookingDate),
        asc(journalEntries.entryNumber),
        asc(journalLines.lineNumber),
      )

    return rows.map((row) => ({
      entryId: row.entryId,
      entryNumber: String(row.entryNumber),
      journalCode: row.journalCode,
      bookingDate: row.bookingDate,
      lineNumber: row.lineNumber,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
      description: row.description ?? '',
      taxCode: row.taxCode,
      taxRole: row.taxRole,
      // The functional amounts, because the return is in euro whatever the
      // invoice was written in.
      signedMinorUnits: row.debit - row.credit,
    }))
  }

  async buildReturn(query: VatPeriodQuery): Promise<VatReturn> {
    const [lines, rules, controlAccountNumbers] = await Promise.all([
      this.periodLines(query),
      this.rules(query.entityId),
      this.controlAccountNumbers(query.entityId),
    ])

    return buildVatReturn({
      periodFrom: query.from,
      periodTo: query.to,
      lines,
      rules,
      controlAccountNumbers,
    })
  }

  async periodKind(entityId: string): Promise<'monthly' | 'quarterly' | 'annual'> {
    const [row] = await this.tx
      .select({ kind: entities.vatPeriodKind })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1)

    return row?.kind ?? 'quarterly'
  }

  async filings(entityId: string): Promise<FilingSummary[]> {
    const rows = await this.tx
      .select({
        id: vatFilings.id,
        periodFrom: vatFilings.periodFrom,
        periodTo: vatFilings.periodTo,
        kind: vatFilings.kind,
        state: vatFilings.state,
        sequence: vatFilings.sequence,
        owed: vatFilings.owedMinorUnits,
        deductible: vatFilings.deductibleMinorUnits,
        payable: vatFilings.payableMinorUnits,
        filedAt: vatFilings.filedAt,
        filedBy: vatFilings.filedBy,
        transport: vatFilings.transport,
        transportReference: vatFilings.transportReference,
      })
      .from(vatFilings)
      .where(eq(vatFilings.entityId, entityId))
      .orderBy(desc(vatFilings.periodFrom), asc(vatFilings.sequence))

    return rows.map((row) => ({ ...row }))
  }

  async filing(entityId: string, filingId: string): Promise<StoredFiling | null> {
    const [row] = await this.tx
      .select()
      .from(vatFilings)
      .where(and(eq(vatFilings.entityId, entityId), eq(vatFilings.id, filingId)))
      .limit(1)

    if (row === undefined) return null
    return {
      id: row.id,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo,
      kind: row.kind,
      state: row.state,
      sequence: row.sequence,
      owedMinorUnits: row.owedMinorUnits,
      deductibleMinorUnits: row.deductibleMinorUnits,
      payableMinorUnits: row.payableMinorUnits,
      rubrieken: row.rubrieken,
      reconciliation: row.reconciliation,
      findings: row.findings,
      filedBy: row.filedBy,
      filedAt: row.filedAt,
      transport: row.transport,
      transportReference: row.transportReference,
      acceptedWarningsBy: row.acceptedWarningsBy,
      acceptedWarningsReason: row.acceptedWarningsReason,
      supersedesId: row.supersedesId,
    }
  }

  /** The live filing for a period, if there is one. */
  async filingForPeriod(
    entityId: string,
    from: string,
    to: string,
  ): Promise<{ id: string; state: string; sequence: number } | null> {
    const rows = await this.tx
      .select({ id: vatFilings.id, state: vatFilings.state, sequence: vatFilings.sequence })
      .from(vatFilings)
      .where(
        and(
          eq(vatFilings.entityId, entityId),
          eq(vatFilings.periodFrom, from),
          eq(vatFilings.periodTo, to),
        ),
      )
      .orderBy(desc(vatFilings.sequence))
      .limit(1)

    return rows[0] ?? null
  }

  /**
   * Soft close every period the declaration covers (spec 7.2: lock on filing).
   *
   * A soft close, not a hard one. Hard close is absolute and enforced by a
   * trigger, which would make a suppletie impossible: correcting a declared
   * period means posting into it. Soft close says "only the accountant", which
   * is the right authority for a correction to a period the tax authority has
   * already been told about.
   *
   * Returns the periods it closed, so the caller can say so.
   */
  async lockPeriods(entityId: string, from: string, to: string): Promise<string[]> {
    const locked = await this.tx
      .update(periods)
      .set({ status: 'soft_closed', updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(periods.entityId, entityId),
          eq(periods.status, 'open'),
          // Overlap, not containment: a monthly filer's period and the books'
          // period are the same month, but an annual filer covers twelve.
          lte(periods.startsOn, to),
          gte(periods.endsOn, from),
        ),
      )
      .returning({ startsOn: periods.startsOn, endsOn: periods.endsOn })

    return locked.map((period) => `${period.startsOn}..${period.endsOn}`)
  }

  async recordFiling(request: RecordFilingRequest): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(vatFilings).values({
      id,
      entityId: request.entityId,
      periodFrom: request.vatReturn.periodFrom,
      periodTo: request.vatReturn.periodTo,
      kind: request.kind,
      state: 'filed',
      sequence: request.sequence,
      supersedesId: request.supersedesId,
      owedMinorUnits: request.vatReturn.owedMinorUnits,
      deductibleMinorUnits: request.vatReturn.deductibleMinorUnits,
      payableMinorUnits: request.vatReturn.payableMinorUnits,
      rubrieken: jsonWithMinorUnits(request.vatReturn.rubrieken),
      reconciliation: jsonWithMinorUnits(request.vatReturn.reconciliation),
      findings: jsonWithMinorUnits(request.vatReturn.findings),
      acceptedWarningsBy: request.acceptedWarningsBy,
      acceptedWarningsReason: request.acceptedWarningsReason,
      filedBy: request.filedBy,
      filedAt: new Date(),
      transport: request.transport,
      transportReference: request.transportReference,
    })

    if (request.supersedesId !== null) {
      await this.tx
        .update(vatFilings)
        .set({ state: 'superseded', updatedAt: new Date() })
        .where(eq(vatFilings.id, request.supersedesId))
    }

    return id
  }
}

/**
 * A bigint has no JSON representation, so every amount is stored as a decimal
 * string — the same shape the wire uses. Never `Number(x)`: a filing is
 * evidence, and evidence does not go through a float.
 */
function jsonWithMinorUnits(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, entry: unknown) =>
      typeof entry === 'bigint' ? entry.toString() : entry,
    ),
  ) as unknown
}

export interface FilingSummary {
  readonly id: string
  readonly periodFrom: string
  readonly periodTo: string
  readonly kind: 'monthly' | 'quarterly' | 'annual'
  readonly state: 'draft' | 'filed' | 'superseded'
  readonly sequence: number
  readonly owed: bigint
  readonly deductible: bigint
  readonly payable: bigint
  readonly filedAt: Date | null
  readonly filedBy: string | null
  readonly transport: string | null
  readonly transportReference: string | null
}

export interface StoredFiling {
  readonly id: string
  readonly periodFrom: string
  readonly periodTo: string
  readonly kind: 'monthly' | 'quarterly' | 'annual'
  readonly state: 'draft' | 'filed' | 'superseded'
  readonly sequence: number
  readonly owedMinorUnits: bigint
  readonly deductibleMinorUnits: bigint
  readonly payableMinorUnits: bigint
  readonly rubrieken: unknown
  readonly reconciliation: unknown
  readonly findings: unknown
  readonly filedBy: string | null
  readonly filedAt: Date | null
  readonly transport: string | null
  readonly transportReference: string | null
  readonly acceptedWarningsBy: string | null
  readonly acceptedWarningsReason: string | null
  readonly supersedesId: string | null
}

export interface RecordFilingRequest {
  readonly entityId: string
  readonly vatReturn: VatReturn
  readonly kind: 'monthly' | 'quarterly' | 'annual'
  readonly sequence: number
  readonly supersedesId: string | null
  readonly filedBy: string
  readonly transport: string
  readonly transportReference: string | null
  readonly acceptedWarningsBy: string | null
  readonly acceptedWarningsReason: string | null
}
