import { violation, LedgerError } from '../errors.js'
import type { BalanceRow } from './reports.js'
import type { AccountType, JournalLineInput, PostJournalEntryCommand } from './types.js'

/**
 * Year close (spec 6.4).
 *
 * "Year close generates a result appropriation entry and opening balances, and
 * is itself a normal reversible entry."
 *
 * Which is the important part: nothing here is a special kind of transaction.
 * Both entries go through `postJournalEntry` like any other, get their gapless
 * number and their slot in the hash chain, and can be reversed if the close was
 * wrong. There is no "unclose" button, because there does not need to be.
 *
 * Two entries, deliberately separate:
 *
 *   1. **Resultaatbestemming**, dated the last day of the closing year. Every
 *      profit-and-loss account is written back to zero against an equity
 *      account. After this the P&L for the year is flat and the result sits in
 *      equity, which is what a balance sheet at year end should show.
 *
 *   2. **Beginbalans**, dated the first day of the new year. Every balance-sheet
 *      account's closing balance is re-posted into the new year.
 *
 * Keeping them separate means an entity that runs a continuous ledger — where
 * balances simply carry forward — can post the first and skip the second, and
 * an entity migrating in halfway through can post the second and skip the
 * first.
 */

const PROFIT_AND_LOSS: ReadonlySet<AccountType> = new Set(['revenue', 'expense'])

export interface YearCloseRequest {
  readonly entityId: string
  /** Where the year's result lands. An equity account. */
  readonly resultAccountNumber: string
  /** Usually a memoriaal. */
  readonly journalCode: string
  readonly closingDate: string
  readonly openingDate: string
  readonly fiscalYearCode: string
}

export interface YearClosePlan {
  /** Null when there is no result and no P&L movement to clear. */
  readonly appropriation: PostJournalEntryCommand | null
  /** Null when there are no balance-sheet balances to carry forward. */
  readonly openingBalance: PostJournalEntryCommand | null
  /** Positive is a profit. */
  readonly result: bigint
  readonly profitAndLossAccountCount: number
  readonly balanceSheetAccountCount: number
}

function line(accountNumber: string, signed: bigint, description: string): JournalLineInput {
  return {
    accountNumber,
    description,
    debit: signed > 0n ? signed : 0n,
    credit: signed < 0n ? -signed : 0n,
    currency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    taxCode: null,
    taxRole: null,
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
  }
}

function closing(row: BalanceRow): bigint {
  return row.openingDebit - row.openingCredit + row.periodDebit - row.periodCredit
}

/**
 * Build the close. Pure: it returns commands, it does not post them.
 *
 * The caller posts them through the normal posting API, in one transaction, and
 * gets the normal guarantees. A dry run therefore comes for free.
 */
export function planYearClose(
  request: YearCloseRequest,
  rows: readonly BalanceRow[],
): YearClosePlan {
  const resultAccount = rows.find((row) => row.accountNumber === request.resultAccountNumber)
  if (resultAccount === undefined) {
    throw new LedgerError([
      violation('unknown_account.account_appropriate_result', 'resultAccountNumber', {
        accountNumber: request.resultAccountNumber,
      }),
    ])
  }
  if (resultAccount.accountType !== 'equity') {
    throw new LedgerError([
      violation('unknown_account.account_year_s', 'resultAccountNumber', {
        accountNumber: request.resultAccountNumber,
        accountType: resultAccount.accountType,
      }),
    ])
  }

  const appropriationLines: JournalLineInput[] = []
  let result = 0n
  let profitAndLossAccounts = 0

  for (const row of rows) {
    if (!PROFIT_AND_LOSS.has(row.accountType)) continue

    // Only the year's own movement is appropriated. A P&L account carrying an
    // opening balance would mean last year was never closed, and rolling that
    // into this year's result would be wrong twice over.
    const signed = row.periodDebit - row.periodCredit
    if (signed === 0n) continue

    profitAndLossAccounts += 1
    // Post the opposite of the balance, which is what flattens the account.
    appropriationLines.push(
      line(row.accountNumber, -signed, `Resultaatbestemming ${request.fiscalYearCode}`),
    )
    result -= signed
  }

  const appropriation: PostJournalEntryCommand | null =
    appropriationLines.length === 0
      ? null
      : {
          entityId: request.entityId,
          journalCode: request.journalCode,
          bookingDate: request.closingDate,
          documentDate: request.closingDate,
          description: `Resultaatbestemming boekjaar ${request.fiscalYearCode}`,
          sourceDocumentRef: `year-close:${request.fiscalYearCode}:appropriation`,
          reversesEntryId: null,
          lines: [
            ...appropriationLines,
            // The balancing side: a profit is a credit to equity.
            line(request.resultAccountNumber, -result, `Resultaat ${request.fiscalYearCode}`),
          ],
        }

  const openingLines: JournalLineInput[] = []
  let balanceSheetAccounts = 0

  for (const row of rows) {
    if (PROFIT_AND_LOSS.has(row.accountType)) continue

    let signed = closing(row)
    // The result account carries the appropriation too, since the opening
    // balance is taken after the close, not before it. Balances here are
    // debit-positive and a profit is a credit to equity, so a profit makes this
    // *more* negative — which is the same `-result` the appropriation posts.
    if (row.accountNumber === request.resultAccountNumber) signed -= result
    if (signed === 0n) continue

    balanceSheetAccounts += 1
    openingLines.push(line(row.accountNumber, signed, `Beginbalans ${request.fiscalYearCode}`))
  }

  const openingBalance: PostJournalEntryCommand | null =
    openingLines.length === 0
      ? null
      : {
          entityId: request.entityId,
          journalCode: request.journalCode,
          bookingDate: request.openingDate,
          documentDate: request.openingDate,
          description: `Beginbalans na afsluiting ${request.fiscalYearCode}`,
          sourceDocumentRef: `year-close:${request.fiscalYearCode}:opening-balance`,
          reversesEntryId: null,
          lines: openingLines,
        }

  return {
    appropriation,
    openingBalance,
    result,
    profitAndLossAccountCount: profitAndLossAccounts,
    balanceSheetAccountCount: balanceSheetAccounts,
  }
}
