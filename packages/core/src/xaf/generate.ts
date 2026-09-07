import { XmlWriter, escapeXml } from '../xml/writer.js'
import {
  XAF_NAMESPACE,
  type XafDocument,
  type XafJournal,
  type XafOpeningBalance,
  type XafTransaction,
  type XafTransactionLine,
} from './model.js'

/**
 * XAF 3.2 generation.
 *
 * Written by hand against the schema rather than through an XML library, for
 * two reasons. XSD sequences are ordered, so the order of the writes below *is*
 * the contract, and having it visible in one readable list is worth more than
 * the generality a builder would buy. And every amount has to be a two-decimal
 * string produced from a bigint without passing through a float — a generic
 * serialiser is exactly where that guarantee gets lost.
 *
 * The output is indented. An auditfile is read by humans as well as machines,
 * and a golden file that diffs cleanly is worth the extra bytes.
 */

/** Re-exported from its old home: several callers and tests import it here. */
export { escapeXml }

/**
 * Minor units to the two-decimal string XAF wants, via integers only.
 *
 * XAF amounts are unsigned; the sign lives in the accompanying `amntTp`. A
 * negative here means the caller has not separated sign from magnitude, which
 * is a bug worth failing on rather than papering over with Math.abs. That is
 * why this is not `decimalString` from the shared writer.
 */
export function xafAmount(minorUnits: bigint): string {
  if (minorUnits < 0n) {
    throw new Error(
      `XAF amounts are unsigned: got ${minorUnits.toString()}. Split the sign into amntTp.`,
    )
  }
  const digits = minorUnits.toString().padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}

interface Totals {
  linesCount: number
  totalDebit: bigint
  totalCredit: bigint
}

function tallyLine(totals: Totals, line: { amount: bigint; amountType: 'D' | 'C' }): void {
  totals.linesCount += 1
  if (line.amountType === 'D') totals.totalDebit += line.amount
  else totals.totalCredit += line.amount
}

function transactionTotals(journals: readonly XafJournal[]): Totals {
  const totals: Totals = { linesCount: 0, totalDebit: 0n, totalCredit: 0n }
  for (const journal of journals) {
    for (const transaction of journal.transactions) {
      for (const line of transaction.lines) tallyLine(totals, line)
    }
  }
  return totals
}

function openingBalanceTotals(openingBalance: XafOpeningBalance): Totals {
  const totals: Totals = { linesCount: 0, totalDebit: 0n, totalCredit: 0n }
  for (const line of openingBalance.lines) tallyLine(totals, line)
  return totals
}

function writeTransactionLine(writer: XmlWriter, line: XafTransactionLine): void {
  writer.open('trLine')
  writer.leaf('nr', line.nr)
  writer.leaf('accID', line.accID)
  writer.leaf('docRef', line.docRef)
  writer.leaf('effDate', line.effDate)
  writer.leaf('desc', line.desc)
  writer.leaf('amnt', xafAmount(line.amount))
  writer.leaf('amntTp', line.amountType)
  writer.leaf('custSupID', line.custSupID)
  writer.leaf('invRef', line.invRef)
  writer.leaf('costID', line.costID)
  writer.leaf('projID', line.projID)

  if (line.vat !== null) {
    writer.open('vat')
    writer.leaf('vatID', line.vat.vatID)
    writer.leaf('vatPerc', line.vat.vatPerc)
    writer.leaf('vatAmnt', xafAmount(line.vat.vatAmnt))
    writer.leaf('vatAmntTp', line.vat.vatAmntTp)
    writer.close('vat')
  }

  if (line.currency !== null) {
    writer.open('currency')
    writer.leaf('curCode', line.currency.curCode)
    writer.leaf('curAmnt', xafAmount(line.currency.curAmnt))
    writer.close('currency')
  }

  writer.close('trLine')
}

function writeTransaction(writer: XmlWriter, transaction: XafTransaction): void {
  writer.open('transaction')
  writer.leaf('nr', transaction.nr)
  writer.leaf('desc', transaction.desc)
  writer.leaf('periodNumber', transaction.periodNumber)
  writer.leaf('trDt', transaction.trDt)
  writer.leaf('sourceID', transaction.sourceID)
  writer.leaf('userID', transaction.userID)
  for (const line of transaction.lines) writeTransactionLine(writer, line)
  writer.close('transaction')
}

export function generateXaf(document: XafDocument): string {
  const writer = new XmlWriter()

  writer.open('auditfile', { xmlns: XAF_NAMESPACE })

  writer.open('header')
  writer.leaf('fiscalYear', document.header.fiscalYear)
  writer.leaf('startDate', document.header.startDate)
  writer.leaf('endDate', document.header.endDate)
  writer.leaf('curCode', document.header.curCode)
  writer.leaf('dateCreated', document.header.dateCreated)
  writer.leaf('softwareDesc', document.header.softwareDesc)
  writer.leaf('softwareVersion', document.header.softwareVersion)
  writer.close('header')

  writer.open('company')
  writer.leaf('companyIdent', document.company.companyIdent)
  writer.leaf('companyName', document.company.companyName)
  writer.leaf('taxRegistrationCountry', document.company.taxRegistrationCountry)
  writer.leaf('taxRegIdent', document.company.taxRegIdent)

  if (document.company.streetAddress !== null) {
    const address = document.company.streetAddress
    writer.open('streetAddress')
    writer.leaf('streetname', address.streetname)
    writer.leaf('number', address.number)
    writer.leaf('city', address.city)
    writer.leaf('postalCode', address.postalCode)
    writer.leaf('country', address.country)
    writer.close('streetAddress')
  }

  if (document.customersSuppliers.length > 0) {
    writer.open('customersSuppliers')
    for (const party of document.customersSuppliers) {
      writer.open('customerSupplier')
      writer.leaf('custSupID', party.custSupID)
      writer.leaf('custSupName', party.custSupName)
      writer.leaf('taxRegistrationCountry', party.taxRegistrationCountry)
      writer.leaf('taxRegIdent', party.taxRegIdent)
      writer.leaf('custSupTp', party.custSupTp)
      writer.close('customerSupplier')
    }
    writer.close('customersSuppliers')
  }

  if (document.ledgerAccounts.length > 0) {
    writer.open('generalLedger')
    for (const account of document.ledgerAccounts) {
      writer.open('ledgerAccount')
      writer.leaf('accID', account.accID)
      writer.leaf('accDesc', account.accDesc)
      writer.leaf('accTp', account.accTp)
      writer.leaf('leadCode', account.leadCode)
      writer.leaf('leadDescription', account.leadDescription)
      writer.leaf('leadReference', account.leadReference)
      writer.close('ledgerAccount')
    }
    writer.close('generalLedger')
  }

  if (document.vatCodes.length > 0) {
    writer.open('vatCodes')
    for (const vatCode of document.vatCodes) {
      writer.open('vatCode')
      writer.leaf('vatID', vatCode.vatID)
      writer.leaf('vatDesc', vatCode.vatDesc)
      writer.leaf('vatToPayAccID', vatCode.vatToPayAccID)
      writer.leaf('vatToClaimAccID', vatCode.vatToClaimAccID)
      writer.close('vatCode')
    }
    writer.close('vatCodes')
  }

  if (document.periods.length > 0) {
    writer.open('periods')
    for (const period of document.periods) {
      writer.open('period')
      writer.leaf('periodNumber', period.periodNumber)
      writer.leaf('periodDesc', period.periodDesc)
      writer.leaf('startDatePeriod', period.startDatePeriod)
      writer.leaf('endDatePeriod', period.endDatePeriod)
      writer.close('period')
    }
    writer.close('periods')
  }

  if (document.openingBalance !== null) {
    const totals = openingBalanceTotals(document.openingBalance)
    writer.open('openingBalance')
    writer.leaf('opBalDate', document.openingBalance.opBalDate)
    writer.leaf('opBalDesc', document.openingBalance.opBalDesc)
    writer.leaf('linesCount', totals.linesCount)
    writer.leaf('totalDebit', xafAmount(totals.totalDebit))
    writer.leaf('totalCredit', xafAmount(totals.totalCredit))
    for (const line of document.openingBalance.lines) {
      writer.open('obLine')
      writer.leaf('nr', line.nr)
      writer.leaf('accID', line.accID)
      writer.leaf('amnt', xafAmount(line.amount))
      writer.leaf('amntTp', line.amountType)
      writer.close('obLine')
    }
    writer.close('openingBalance')
  }

  const totals = transactionTotals(document.journals)
  writer.open('transactions')
  writer.leaf('linesCount', totals.linesCount)
  writer.leaf('totalDebit', xafAmount(totals.totalDebit))
  writer.leaf('totalCredit', xafAmount(totals.totalCredit))

  for (const journal of document.journals) {
    writer.open('journal')
    writer.leaf('jrnID', journal.jrnID)
    writer.leaf('desc', journal.desc)
    writer.leaf('jrnTp', journal.jrnTp)
    writer.leaf('offsetAccID', journal.offsetAccID)
    for (const transaction of journal.transactions) writeTransaction(writer, transaction)
    writer.close('journal')
  }

  writer.close('transactions')
  writer.close('company')
  writer.close('auditfile')

  return `<?xml version="1.0" encoding="UTF-8"?>\n${writer.toString()}`
}
