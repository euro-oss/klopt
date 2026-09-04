import {
  xafAccountType,
  xafJournalType,
  type XafDocument,
  type XafJournal,
  type XafLedgerAccount,
  type XafOpeningBalanceLine,
  type XafPeriod,
  type XafTransaction,
  type XafTransactionLine,
} from '@klopt/core'
import type { RgsScheme } from '@klopt/core'
import { and, asc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import {
  accountPeriodBalances,
  accounts,
  dimensionTypes,
  dimensionValues,
  entities,
  fiscalYears,
  journalEntries,
  journalLineDimensions,
  journalLines,
  journals,
  periods,
} from '../schema/index.js'

/**
 * Assembling an XAF 3.2 document from the ledger (spec 7.3).
 *
 * Read-only and streaming-shaped: the query pulls the fiscal year's lines in
 * one pass ordered by journal and entry, so building the document is a fold
 * rather than N+1 lookups per transaction.
 *
 * The RGS scheme is passed in rather than looked up, because which version an
 * entity is mapped against is a property of the entity and resolving it is the
 * caller's job.
 */

export interface XafExportRequest {
  readonly entityId: string
  readonly fiscalYearCode: string
  /** Defaults to the whole year. */
  readonly fromPeriod?: number
  readonly toPeriod?: number
  readonly softwareDesc: string
  readonly softwareVersion: string
  readonly generatedOn: string
}

export class XafExportRepository {
  constructor(private readonly tx: Transaction) {}

  async build(request: XafExportRequest, scheme: RgsScheme | null): Promise<XafDocument> {
    const [entity] = await this.tx
      .select()
      .from(entities)
      .where(eq(entities.id, request.entityId))
      .limit(1)

    if (entity === undefined) throw new Error(`No entity ${request.entityId}.`)

    const [fiscalYear] = await this.tx
      .select()
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.entityId, request.entityId),
          eq(fiscalYears.code, request.fiscalYearCode),
        ),
      )
      .limit(1)

    if (fiscalYear === undefined) {
      throw new Error(`No fiscal year ${request.fiscalYearCode} for this entity.`)
    }

    const fromPeriod = request.fromPeriod ?? 1
    const toPeriod = request.toPeriod ?? 13

    const periodRows = await this.tx
      .select()
      .from(periods)
      .where(
        and(
          eq(periods.fiscalYearId, fiscalYear.id),
          gte(periods.sequence, fromPeriod),
          lte(periods.sequence, toPeriod),
        ),
      )
      .orderBy(asc(periods.sequence))

    const xafPeriods: XafPeriod[] = periodRows.map((period) => ({
      periodNumber: period.sequence,
      periodDesc: null,
      startDatePeriod: period.startsOn,
      endDatePeriod: period.endsOn,
    }))

    const accountRows = await this.tx
      .select()
      .from(accounts)
      .where(eq(accounts.entityId, request.entityId))
      .orderBy(asc(accounts.number))

    const ledgerAccounts: XafLedgerAccount[] = accountRows.map((account) => {
      const code = account.rgsCode === null ? undefined : scheme?.get(account.rgsCode)
      return {
        accID: account.number,
        accDesc: account.name,
        accTp: xafAccountType(account.type),
        leadCode: account.rgsCode,
        leadDescription: code?.description ?? null,
        leadReference: code?.referenceNumber ?? null,
      }
    })

    const openingBalance = await this.buildOpeningBalance(
      request.entityId,
      periodRows[0]?.startsOn ?? fiscalYear.startsOn,
      entity.functionalCurrency,
      accountRows,
    )

    const journalRows = await this.tx
      .select()
      .from(journals)
      .where(eq(journals.entityId, request.entityId))
      .orderBy(asc(journals.code))

    const periodIds = periodRows.map((period) => period.id)
    const lineRows =
      periodIds.length === 0
        ? []
        : await this.tx
            .select({
              journalId: journalEntries.journalId,
              entryId: journalEntries.id,
              entryNumber: journalEntries.entryNumber,
              entryDescription: journalEntries.description,
              bookingDate: journalEntries.bookingDate,
              documentDate: journalEntries.documentDate,
              sourceDocumentRef: journalEntries.sourceDocumentRef,
              actorId: journalEntries.actorId,
              periodSequence: periods.sequence,
              lineId: journalLines.id,
              lineNumber: journalLines.lineNumber,
              accountNumber: accounts.number,
              lineDescription: journalLines.description,
              debit: journalLines.debitMinorUnits,
              credit: journalLines.creditMinorUnits,
              currency: journalLines.currency,
              functionalDebit: journalLines.functionalDebitMinorUnits,
              functionalCredit: journalLines.functionalCreditMinorUnits,
              taxCode: journalLines.taxCode,
              taxAmount: journalLines.taxMinorUnits,
              subledgerKind: journalLines.subledgerKind,
              subledgerId: journalLines.subledgerId,
            })
            .from(journalLines)
            .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
            .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
            .innerJoin(periods, eq(periods.id, journalEntries.periodId))
            .where(
              and(
                eq(journalLines.entityId, request.entityId),
                inArray(journalEntries.periodId, periodIds),
              ),
            )
            .orderBy(
              asc(journalEntries.journalId),
              asc(journalEntries.entryNumber),
              asc(journalLines.lineNumber),
            )

    // Cost centre and project are the two analytic dimensions XAF has fields
    // for. An entity's other dimensions have nowhere to go in 3.2; they stay in
    // the ledger and travel in the CSV and API exports instead.
    const dimensionRows =
      lineRows.length === 0
        ? []
        : await this.tx
            .select({
              lineId: journalLineDimensions.lineId,
              typeCode: dimensionTypes.code,
              valueCode: dimensionValues.code,
            })
            .from(journalLineDimensions)
            .innerJoin(dimensionTypes, eq(dimensionTypes.id, journalLineDimensions.dimensionTypeId))
            .innerJoin(
              dimensionValues,
              eq(dimensionValues.id, journalLineDimensions.dimensionValueId),
            )
            .where(
              and(
                eq(journalLineDimensions.entityId, request.entityId),
                inArray(
                  journalLineDimensions.lineId,
                  lineRows.map((row) => row.lineId),
                ),
              ),
            )

    const dimensionsByLine = new Map<string, Map<string, string>>()
    for (const row of dimensionRows) {
      const existing = dimensionsByLine.get(row.lineId) ?? new Map<string, string>()
      existing.set(row.typeCode.toUpperCase(), row.valueCode)
      dimensionsByLine.set(row.lineId, existing)
    }

    const journalsById = new Map(journalRows.map((journal) => [journal.id, journal]))
    const byJournal = new Map<string, Map<string, XafTransactionLine[]>>()
    const transactionMeta = new Map<string, (typeof lineRows)[number]>()

    for (const row of lineRows) {
      const perJournal = byJournal.get(row.journalId) ?? new Map<string, XafTransactionLine[]>()
      const key = String(row.entryNumber)
      const lines = perJournal.get(key) ?? []

      const signedDebit = row.functionalDebit
      const signedCredit = row.functionalCredit
      const isDebit = signedDebit > 0n
      const dimensions = dimensionsByLine.get(row.lineId)

      lines.push({
        nr: String(row.lineNumber),
        accID: row.accountNumber,
        // XAF requires docRef. The source document if there is one, otherwise
        // the entry's own identity, which is the only honest fallback.
        docRef: row.sourceDocumentRef ?? `${String(row.entryNumber)}`,
        effDate: row.documentDate,
        desc: row.lineDescription,
        amount: isDebit ? signedDebit : signedCredit,
        amountType: isDebit ? 'D' : 'C',
        custSupID: row.subledgerId,
        invRef: null,
        costID: dimensions?.get('COSTCENTRE') ?? dimensions?.get('KOSTENPLAATS') ?? null,
        projID: dimensions?.get('PROJECT') ?? null,
        vat:
          row.taxCode === null || row.taxAmount === null
            ? null
            : {
                vatID: row.taxCode,
                vatPerc: '0',
                vatAmnt: row.taxAmount < 0n ? -row.taxAmount : row.taxAmount,
                vatAmntTp: row.taxAmount < 0n ? 'C' : 'D',
              },
        currency:
          row.currency === entity.functionalCurrency
            ? null
            : {
                curCode: row.currency,
                curAmnt: row.debit > 0n ? row.debit : row.credit,
              },
      })

      perJournal.set(key, lines)
      byJournal.set(row.journalId, perJournal)
      if (!transactionMeta.has(`${row.journalId}:${key}`)) {
        transactionMeta.set(`${row.journalId}:${key}`, row)
      }
    }

    const xafJournals: XafJournal[] = []
    for (const [journalId, perJournal] of byJournal) {
      const journal = journalsById.get(journalId)
      if (journal === undefined) continue

      const transactions: XafTransaction[] = []
      for (const [number, lines] of perJournal) {
        const meta = transactionMeta.get(`${journalId}:${number}`)
        if (meta === undefined) continue
        transactions.push({
          nr: number,
          desc: meta.entryDescription,
          periodNumber: meta.periodSequence,
          trDt: meta.bookingDate,
          sourceID: meta.sourceDocumentRef,
          userID: meta.actorId,
          lines,
        })
      }

      transactions.sort((a, b) => Number(a.nr) - Number(b.nr))

      xafJournals.push({
        jrnID: journal.code,
        desc: journal.name,
        jrnTp: xafJournalType(journal.type),
        offsetAccID: null,
        transactions,
      })
    }

    xafJournals.sort((a, b) => a.jrnID.localeCompare(b.jrnID))

    return {
      header: {
        fiscalYear: fiscalYear.code,
        startDate: periodRows[0]?.startsOn ?? fiscalYear.startsOn,
        endDate: periodRows.at(-1)?.endsOn ?? fiscalYear.endsOn,
        curCode: entity.functionalCurrency,
        dateCreated: request.generatedOn,
        softwareDesc: request.softwareDesc,
        softwareVersion: request.softwareVersion,
      },
      company: {
        companyIdent: entity.kvkNumber,
        companyName: entity.legalName,
        taxRegistrationCountry: 'NL',
        taxRegIdent: entity.vatNumber ?? '',
        streetAddress: null,
      },
      // Debtors and creditors arrive with Sales in M1. The element is optional
      // and an empty one would be worse than none.
      customersSuppliers: [],
      ledgerAccounts,
      // The tax code engine is M3. Emitting invented codes would make the file
      // wrong in a way that is hard to notice.
      vatCodes: [],
      periods: xafPeriods,
      openingBalance,
      journals: xafJournals,
    }
  }

  private async buildOpeningBalance(
    entityId: string,
    startDate: string,
    currency: string,
    accountRows: readonly { id: string; number: string }[],
  ) {
    const earlierPeriods = await this.tx
      .select({ id: periods.id })
      .from(periods)
      .where(and(eq(periods.entityId, entityId), lt(periods.endsOn, startDate)))

    if (earlierPeriods.length === 0) return null

    const balances = await this.tx
      .select({
        accountId: accountPeriodBalances.accountId,
        debit: accountPeriodBalances.debitMinorUnits,
        credit: accountPeriodBalances.creditMinorUnits,
      })
      .from(accountPeriodBalances)
      .where(
        and(
          eq(accountPeriodBalances.entityId, entityId),
          eq(accountPeriodBalances.currency, currency),
          inArray(
            accountPeriodBalances.periodId,
            earlierPeriods.map((period) => period.id),
          ),
        ),
      )

    const numbersById = new Map(accountRows.map((account) => [account.id, account.number]))
    const totals = new Map<string, bigint>()
    for (const balance of balances) {
      const number = numbersById.get(balance.accountId)
      if (number === undefined) continue
      totals.set(number, (totals.get(number) ?? 0n) + balance.debit - balance.credit)
    }

    const lines: XafOpeningBalanceLine[] = []
    let index = 0
    for (const [accountNumber, signed] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
      if (signed === 0n) continue
      index += 1
      lines.push({
        nr: String(index),
        accID: accountNumber,
        amount: signed > 0n ? signed : -signed,
        amountType: signed > 0n ? 'D' : 'C',
      })
    }

    if (lines.length === 0) return null

    return { opBalDate: startDate, opBalDesc: 'Beginbalans', lines }
  }
}
