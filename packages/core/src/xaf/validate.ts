import { XAF_LIMITS, type XafDocument } from './model.js'
import { renderFindingMessage, type FindingMessageKey } from '../finding-messages.js'

/**
 * Semantic validation of an XAF document (spec 7.3).
 *
 * "Validates against the published schema before it is offered for download. An
 * invalid XAF is a build-breaking bug, not a warning."
 *
 * Two layers, because they catch different things:
 *
 *   * **This** runs before every download. It checks what an accountant or an
 *     inspector would actually notice — that the control totals match the
 *     lines, that every reference resolves, that the file balances, that
 *     nothing overflows a field length. XSD cannot express any of it.
 *   * **The XSD** runs in CI against the golden files, using the published
 *     schema in `reference-data/xaf/`. That catches structural drift: an
 *     element in the wrong order, a missing required field.
 *
 * Doing only the schema check would pass a file whose totals are wrong. Doing
 * only this one would pass a file no other package can read.
 */

export type XafProblemSeverity = 'error' | 'warning'

/**
 * What is wrong with the file, as a code rather than only as prose.
 *
 * An import report is read by a person and by a script. The person wants the
 * sentence; the script wants to know whether it is looking at a file that does
 * not balance or one with a duplicate account, and it cannot get that from
 * English. Added in ADR 0048 for the same reason `LedgerErrorCode` exists.
 */
export type XafProblemCode =
  | 'field_too_long'
  | 'invalid_date'
  | 'period_reversed'
  | 'invalid_currency'
  | 'invalid_country'
  | 'duplicate_account'
  | 'accounts_without_rgs'
  | 'unknown_account'
  | 'duplicate_journal'
  | 'duplicate_transaction'
  | 'date_outside_fiscal_year'
  | 'unknown_period'
  | 'transaction_without_lines'
  | 'negative_amount'
  | 'unknown_party'
  | 'unknown_vat_code'
  | 'transaction_unbalanced'
  | 'file_unbalanced'
  | 'opening_balance_unbalanced'

export interface XafProblem {
  readonly severity: XafProblemSeverity
  readonly code: XafProblemCode
  readonly path: string
  readonly message: string
  /** Which sentence this is, and the values in it, for a client that translates. */
  readonly messageKey: FindingMessageKey
  readonly detail?: Readonly<Record<string, string>>
}

export interface XafValidationResult {
  readonly valid: boolean
  readonly problems: readonly XafProblem[]
  readonly lineCount: number
  readonly totalDebit: bigint
  readonly totalCredit: bigint
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateXafDocument(document: XafDocument): XafValidationResult {
  const problems: XafProblem[] = []
  const report =
    (severity: XafProblemSeverity) =>
    (
      path: string,
      code: XafProblemCode,
      messageKey: FindingMessageKey,
      detail?: Readonly<Record<string, string>>,
    ): void => {
      problems.push({
        severity,
        code,
        path,
        message: renderFindingMessage(messageKey, detail),
        messageKey,
        ...(detail === undefined ? {} : { detail }),
      })
    }
  const error = report('error')
  const warn = report('warning')

  const checkLength = (path: string, value: string | null, limit: number): void => {
    if (value !== null && value.length > limit) {
      error(path, 'field_too_long', 'xaf.field_too_long', {
        limit: String(limit),
        count: String(value.length),
      })
    }
  }

  const checkDate = (path: string, value: string): void => {
    if (!DATE.test(value)) error(path, 'invalid_date', 'xaf.invalid_date', { value })
  }

  checkDate('header.startDate', document.header.startDate)
  checkDate('header.endDate', document.header.endDate)
  checkDate('header.dateCreated', document.header.dateCreated)
  checkLength('header.fiscalYear', document.header.fiscalYear, XAF_LIMITS.string9)

  if (document.header.endDate < document.header.startDate) {
    error('header', 'period_reversed', 'xaf.period_reversed', undefined)
  }
  if (!/^[A-Z]{3}$/.test(document.header.curCode)) {
    error('header.curCode', 'invalid_currency', 'xaf.invalid_currency', {
      curCode: document.header.curCode,
    })
  }

  checkLength('company.companyName', document.company.companyName, XAF_LIMITS.string999)
  checkLength('company.taxRegIdent', document.company.taxRegIdent, XAF_LIMITS.string30)
  if (!/^[A-Z]{2}$/.test(document.company.taxRegistrationCountry)) {
    error('company.taxRegistrationCountry', 'invalid_country', 'xaf.invalid_country', undefined)
  }

  const accountIds = new Set<string>()
  for (const account of document.ledgerAccounts) {
    if (accountIds.has(account.accID)) {
      error('generalLedger', 'duplicate_account', 'xaf.duplicate_account', { accID: account.accID })
    }
    accountIds.add(account.accID)
    checkLength(`generalLedger.${account.accID}.accID`, account.accID, XAF_LIMITS.identification35)
    checkLength(`generalLedger.${account.accID}.accDesc`, account.accDesc, XAF_LIMITS.string999)
  }

  const unmapped = document.ledgerAccounts.filter((account) => account.leadCode === null)
  if (unmapped.length > 0) {
    // Not an error: XAF permits it. But the ODB is pushing XAF *with* RGS, and
    // an accountant receiving this file will notice, so say so before they do.
    const listed = unmapped
      .slice(0, 5)
      .map((account) => account.accID)
      .join(', ')
    warn('generalLedger', 'accounts_without_rgs', 'xaf.accounts_without_rgs', {
      unmapped: String(unmapped.length),
      total: String(document.ledgerAccounts.length),
      accounts: `${listed}${unmapped.length > 5 ? ', …' : ''}`,
    })
  }

  const partyIds = new Set(document.customersSuppliers.map((party) => party.custSupID))
  const vatIds = new Set(document.vatCodes.map((code) => code.vatID))
  const periodNumbers = new Set(document.periods.map((period) => period.periodNumber))

  for (const vatCode of document.vatCodes) {
    for (const [field, accountId] of [
      ['vatToPayAccID', vatCode.vatToPayAccID],
      ['vatToClaimAccID', vatCode.vatToClaimAccID],
    ] as const) {
      if (accountId !== null && !accountIds.has(accountId)) {
        error(`vatCodes.${vatCode.vatID}.${field}`, 'unknown_account', 'xaf.unknown_account', {
          accountId,
        })
      }
    }
  }

  let lineCount = 0
  let totalDebit = 0n
  let totalCredit = 0n

  const journalIds = new Set<string>()

  for (const journal of document.journals) {
    if (journalIds.has(journal.jrnID))
      error('transactions', 'duplicate_journal', 'xaf.duplicate_journal', { jrnID: journal.jrnID })
    journalIds.add(journal.jrnID)
    checkLength(`journal.${journal.jrnID}.jrnID`, journal.jrnID, XAF_LIMITS.identification35)

    if (journal.offsetAccID !== null && !accountIds.has(journal.offsetAccID)) {
      error(
        `journal.${journal.jrnID}.offsetAccID`,
        'unknown_account',
        'xaf.unknown_offset_account',
        { offsetAccID: journal.offsetAccID },
      )
    }

    const transactionNumbers = new Set<string>()

    for (const transaction of journal.transactions) {
      const where = `journal.${journal.jrnID}.transaction.${transaction.nr}`

      if (transactionNumbers.has(transaction.nr)) {
        error(where, 'duplicate_transaction', 'xaf.duplicate_transaction', { nr: transaction.nr })
      }
      transactionNumbers.add(transaction.nr)

      checkDate(`${where}.trDt`, transaction.trDt)
      if (
        transaction.trDt < document.header.startDate ||
        transaction.trDt > document.header.endDate
      ) {
        error(`${where}.trDt`, 'date_outside_fiscal_year', 'xaf.date_outside_fiscal_year', {
          trDt: transaction.trDt,
        })
      }
      if (!periodNumbers.has(transaction.periodNumber)) {
        error(`${where}.periodNumber`, 'unknown_period', 'xaf.unknown_period', {
          periodNumber: String(transaction.periodNumber),
        })
      }

      if (transaction.lines.length === 0) {
        error(where, 'transaction_without_lines', 'xaf.transaction_without_lines', undefined)
      }

      let transactionDebit = 0n
      let transactionCredit = 0n

      for (const line of transaction.lines) {
        lineCount += 1
        const linePath = `${where}.line.${line.nr}`

        if (line.amount < 0n) error(linePath, 'negative_amount', 'xaf.negative_amount', undefined)

        if (line.amountType === 'D') {
          totalDebit += line.amount
          transactionDebit += line.amount
        } else {
          totalCredit += line.amount
          transactionCredit += line.amount
        }

        if (!accountIds.has(line.accID)) {
          error(`${linePath}.accID`, 'unknown_account', 'xaf.unknown_account', {
            accountId: line.accID,
          })
        }
        if (line.custSupID !== null && !partyIds.has(line.custSupID)) {
          error(`${linePath}.custSupID`, 'unknown_party', 'xaf.unknown_party', {
            custSupID: line.custSupID,
          })
        }
        if (line.vat !== null && !vatIds.has(line.vat.vatID)) {
          error(`${linePath}.vat.vatID`, 'unknown_vat_code', 'xaf.unknown_vat_code', {
            vatID: line.vat.vatID,
          })
        }
        checkDate(`${linePath}.effDate`, line.effDate)
        checkLength(`${linePath}.desc`, line.desc, XAF_LIMITS.string9999)
        checkLength(`${linePath}.docRef`, line.docRef, XAF_LIMITS.string999)
      }

      if (transactionDebit !== transactionCredit) {
        error(where, 'transaction_unbalanced', 'xaf.transaction_unbalanced', {
          transactionDebit: transactionDebit.toString(),
          transactionCredit: transactionCredit.toString(),
        })
      }
    }
  }

  if (totalDebit !== totalCredit) {
    error('transactions', 'file_unbalanced', 'xaf.file_unbalanced', {
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
    })
  }

  if (document.openingBalance !== null) {
    let openingDebit = 0n
    let openingCredit = 0n
    for (const line of document.openingBalance.lines) {
      if (!accountIds.has(line.accID)) {
        error(`openingBalance.${line.nr}.accID`, 'unknown_account', 'xaf.unknown_account', {
          accountId: line.accID,
        })
      }
      if (line.amountType === 'D') openingDebit += line.amount
      else openingCredit += line.amount
    }
    if (openingDebit !== openingCredit) {
      error('openingBalance', 'opening_balance_unbalanced', 'xaf.opening_balance_unbalanced', {
        openingDebit: openingDebit.toString(),
        openingCredit: openingCredit.toString(),
      })
    }
  }

  return {
    valid: !problems.some((problem) => problem.severity === 'error'),
    problems,
    lineCount,
    totalDebit,
    totalCredit,
  }
}
