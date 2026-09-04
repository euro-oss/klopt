import { XAF_LIMITS, type XafDocument } from './model.js'

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

export interface XafProblem {
  readonly severity: XafProblemSeverity
  readonly path: string
  readonly message: string
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
  const error = (path: string, message: string): void => {
    problems.push({ severity: 'error', path, message })
  }
  const warn = (path: string, message: string): void => {
    problems.push({ severity: 'warning', path, message })
  }

  const checkLength = (path: string, value: string | null, limit: number): void => {
    if (value !== null && value.length > limit) {
      error(
        path,
        `Exceeds the schema's ${String(limit)} character limit (${String(value.length)}).`,
      )
    }
  }

  const checkDate = (path: string, value: string): void => {
    if (!DATE.test(value)) error(path, `"${value}" is not an ISO date.`)
  }

  checkDate('header.startDate', document.header.startDate)
  checkDate('header.endDate', document.header.endDate)
  checkDate('header.dateCreated', document.header.dateCreated)
  checkLength('header.fiscalYear', document.header.fiscalYear, XAF_LIMITS.string9)

  if (document.header.endDate < document.header.startDate) {
    error('header', 'endDate is before startDate.')
  }
  if (!/^[A-Z]{3}$/.test(document.header.curCode)) {
    error('header.curCode', `"${document.header.curCode}" is not an ISO 4217 code.`)
  }

  checkLength('company.companyName', document.company.companyName, XAF_LIMITS.string999)
  checkLength('company.taxRegIdent', document.company.taxRegIdent, XAF_LIMITS.string30)
  if (!/^[A-Z]{2}$/.test(document.company.taxRegistrationCountry)) {
    error('company.taxRegistrationCountry', 'Must be a two-letter ISO 3166 code.')
  }

  const accountIds = new Set<string>()
  for (const account of document.ledgerAccounts) {
    if (accountIds.has(account.accID)) {
      error('generalLedger', `Duplicate account ${account.accID}.`)
    }
    accountIds.add(account.accID)
    checkLength(`generalLedger.${account.accID}.accID`, account.accID, XAF_LIMITS.identification35)
    checkLength(`generalLedger.${account.accID}.accDesc`, account.accDesc, XAF_LIMITS.string999)
  }

  const unmapped = document.ledgerAccounts.filter((account) => account.leadCode === null)
  if (unmapped.length > 0) {
    // Not an error: XAF permits it. But the ODB is pushing XAF *with* RGS, and
    // an accountant receiving this file will notice, so say so before they do.
    warn(
      'generalLedger',
      `${String(unmapped.length)} of ${String(document.ledgerAccounts.length)} accounts have no RGS lead code: ${unmapped
        .slice(0, 5)
        .map((account) => account.accID)
        .join(', ')}${unmapped.length > 5 ? ', …' : ''}`,
    )
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
        error(`vatCodes.${vatCode.vatID}.${field}`, `References unknown account ${accountId}.`)
      }
    }
  }

  let lineCount = 0
  let totalDebit = 0n
  let totalCredit = 0n

  const journalIds = new Set<string>()

  for (const journal of document.journals) {
    if (journalIds.has(journal.jrnID)) error('transactions', `Duplicate journal ${journal.jrnID}.`)
    journalIds.add(journal.jrnID)
    checkLength(`journal.${journal.jrnID}.jrnID`, journal.jrnID, XAF_LIMITS.identification35)

    if (journal.offsetAccID !== null && !accountIds.has(journal.offsetAccID)) {
      error(`journal.${journal.jrnID}.offsetAccID`, `Unknown account ${journal.offsetAccID}.`)
    }

    const transactionNumbers = new Set<string>()

    for (const transaction of journal.transactions) {
      const where = `journal.${journal.jrnID}.transaction.${transaction.nr}`

      if (transactionNumbers.has(transaction.nr)) {
        error(where, `Duplicate transaction number ${transaction.nr} in this journal.`)
      }
      transactionNumbers.add(transaction.nr)

      checkDate(`${where}.trDt`, transaction.trDt)
      if (
        transaction.trDt < document.header.startDate ||
        transaction.trDt > document.header.endDate
      ) {
        error(`${where}.trDt`, `${transaction.trDt} is outside the fiscal year in the header.`)
      }
      if (!periodNumbers.has(transaction.periodNumber)) {
        error(
          `${where}.periodNumber`,
          `Period ${String(transaction.periodNumber)} is not declared.`,
        )
      }

      if (transaction.lines.length === 0) {
        error(where, 'A transaction with no lines.')
      }

      let transactionDebit = 0n
      let transactionCredit = 0n

      for (const line of transaction.lines) {
        lineCount += 1
        const linePath = `${where}.line.${line.nr}`

        if (line.amount < 0n) error(linePath, 'XAF amounts are unsigned.')

        if (line.amountType === 'D') {
          totalDebit += line.amount
          transactionDebit += line.amount
        } else {
          totalCredit += line.amount
          transactionCredit += line.amount
        }

        if (!accountIds.has(line.accID)) {
          error(`${linePath}.accID`, `References unknown account ${line.accID}.`)
        }
        if (line.custSupID !== null && !partyIds.has(line.custSupID)) {
          error(`${linePath}.custSupID`, `References unknown party ${line.custSupID}.`)
        }
        if (line.vat !== null && !vatIds.has(line.vat.vatID)) {
          error(`${linePath}.vat.vatID`, `References unknown VAT code ${line.vat.vatID}.`)
        }
        checkDate(`${linePath}.effDate`, line.effDate)
        checkLength(`${linePath}.desc`, line.desc, XAF_LIMITS.string9999)
        checkLength(`${linePath}.docRef`, line.docRef, XAF_LIMITS.string999)
      }

      if (transactionDebit !== transactionCredit) {
        error(
          where,
          `Does not balance: ${transactionDebit.toString()} debit against ${transactionCredit.toString()} credit, in minor units.`,
        )
      }
    }
  }

  if (totalDebit !== totalCredit) {
    error(
      'transactions',
      `The file does not balance: ${totalDebit.toString()} debit against ${totalCredit.toString()} credit.`,
    )
  }

  if (document.openingBalance !== null) {
    let openingDebit = 0n
    let openingCredit = 0n
    for (const line of document.openingBalance.lines) {
      if (!accountIds.has(line.accID)) {
        error(`openingBalance.${line.nr}.accID`, `References unknown account ${line.accID}.`)
      }
      if (line.amountType === 'D') openingDebit += line.amount
      else openingCredit += line.amount
    }
    if (openingDebit !== openingCredit) {
      error(
        'openingBalance',
        `Does not balance: ${openingDebit.toString()} debit against ${openingCredit.toString()} credit.`,
      )
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
