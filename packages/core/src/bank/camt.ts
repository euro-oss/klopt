import {
  at,
  childrenNamed,
  descendants,
  parseXmlDocument,
  textAt,
  type XmlElement,
} from '../xml/index.js'
import { BankStatementError, parseBankAmount, type BankEntry, type BankStatement } from './model.js'

/**
 * CAMT.053, the ISO 20022 statement (spec 7.4).
 *
 * Structured where MT940 is free text, and correspondingly less guesswork. The
 * two places it still needs care:
 *
 * **The counterparty depends on the direction.** A credit entry's counterparty
 * is the debtor; a debit entry's is the creditor. Reading `Dbtr` unconditionally
 * gets it right half the time, which is the worst possible hit rate for a
 * matching engine that then learns from it.
 *
 * **An entry may be one transaction or several.** `NtryDtls/TxDtls` repeats for
 * a batch. The entry is what the bank booked and what the balance moves by, so
 * that is what becomes a `BankEntry`; the details are read for references and
 * names, and a batch keeps the entry-level amount rather than being split. Spec
 * 7.4 wants batch payments matched against many invoices, and that is the
 * matching engine's job, not the parser's.
 */

function requiredText(element: XmlElement, path: string, where: string): string {
  const value = textAt(element, path)
  if (value === null) throw new BankStatementError(`<${path}> is required.`, where)
  return value
}

/** An `<Amt Ccy="EUR">` plus its `CdtDbtInd`, as signed minor units. */
function signedAmount(element: XmlElement, where: string): { amount: bigint; currency: string } {
  const amount = at(element, 'Amt')
  if (amount === undefined) throw new BankStatementError('<Amt> is required.', where)

  const magnitude = parseBankAmount(amount.text, where)
  const indicator = textAt(element, 'CdtDbtInd')
  if (indicator !== 'CRDT' && indicator !== 'DBIT') {
    throw new BankStatementError(`CdtDbtInd is "${String(indicator)}".`, where)
  }

  return {
    amount: indicator === 'CRDT' ? magnitude : -magnitude,
    currency: amount.attributes['Ccy'] ?? 'EUR',
  }
}

function dateOf(element: XmlElement | undefined): string | null {
  if (element === undefined) return null
  // `Dt` is a date, `DtTm` a timestamp. Both reduce to a day.
  const value = textAt(element, 'Dt') ?? textAt(element, 'DtTm') ?? element.text
  return value === '' ? null : value.slice(0, 10)
}

/** OPBD/PRCD is the opening balance, CLBD the closing one. */
function balanceOf(statement: XmlElement, codes: readonly string[], where: string) {
  for (const wanted of codes) {
    for (const balance of childrenNamed(statement, 'Bal')) {
      const code = textAt(balance, 'Tp/CdOrPrtry/Cd')
      if (code !== wanted) continue
      const { amount } = signedAmount(balance, `${where} Bal/${wanted}`)
      return { amount, date: dateOf(at(balance, 'Dt')) }
    }
  }
  throw new BankStatementError(`No ${codes.join(' or ')} balance.`, where)
}

function entryFrom(entry: XmlElement, index: number, fallbackCurrency: string): BankEntry {
  const where = `Ntry[${String(index + 1)}]`
  const { amount, currency } = signedAmount(entry, where)
  const incoming = amount > 0n

  const details = descendants(entry, 'TxDtls')

  /**
   * The counterparty is whoever is on the other side, which depends on the
   * direction. On a batch, take the first — the matching engine gets the whole
   * entry and the description, and inventing a composite name would be worse
   * than one real one.
   */
  const party = details
    .map((detail) => at(detail, `RltdPties/${incoming ? 'Dbtr' : 'Cdtr'}`))
    .find((found) => found !== undefined)
  const partyAccount = details
    .map((detail) => at(detail, `RltdPties/${incoming ? 'DbtrAcct' : 'CdtrAcct'}`))
    .find((found) => found !== undefined)

  const remittance = details.flatMap((detail) => {
    const info = at(detail, 'RmtInf')
    if (info === undefined) return []
    return childrenNamed(info, 'Ustrd').map((line) => line.text)
  })

  const structured = details
    .map((detail) => textAt(detail, 'RmtInf/Strd/CdtrRefInf/Ref'))
    .find((found) => found !== null && found !== '')

  const endToEnd = details
    .map((detail) => textAt(detail, 'Refs/EndToEndId'))
    .find((found) => found !== null && found !== '' && found !== 'NOTPROVIDED')

  const bookingDate = dateOf(at(entry, 'BookgDt'))
  const valueDate = dateOf(at(entry, 'ValDt'))
  if (bookingDate === null) throw new BankStatementError('<BookgDt> is required.', where)

  const code =
    textAt(entry, 'BkTxCd/Domn/Fmly/SubFmlyCd') ?? textAt(entry, 'BkTxCd/Prtry/Cd') ?? null

  // `AddtlNtryInf` is where several Dutch banks put the human description when
  // there is no structured remittance at all.
  const additional = textAt(entry, 'AddtlNtryInf')
  const description = [...remittance, additional]
    .filter((part): part is string => part !== null && part !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    amount,
    currency: currency === '' ? fallbackCurrency : currency,
    bookingDate,
    valueDate: valueDate ?? bookingDate,
    bankReference: textAt(entry, 'AcctSvcrRef'),
    endToEndId: endToEnd ?? null,
    counterpartyName: party === undefined ? null : textAt(party, 'Nm'),
    counterpartyIban: partyAccount === undefined ? null : textAt(partyAccount, 'Id/IBAN'),
    description,
    remittanceReference: structured ?? null,
    transactionCode: code,
    raw: JSON.stringify({
      amount: amount.toString(),
      bookingDate,
      reference: textAt(entry, 'AcctSvcrRef'),
      description,
    }),
  }
}

export function parseCamt053(source: string): readonly BankStatement[] {
  const root = parseXmlDocument(source)

  // `Document/BkToCstmrStmt/Stmt`, but real files vary in whether the outer
  // Document element is there at all.
  const report = at(root, 'BkToCstmrStmt') ?? root
  const statements = childrenNamed(report, 'Stmt')

  if (statements.length === 0) {
    throw new BankStatementError('No <Stmt>. Is this a CAMT.053 statement?', 'document')
  }

  return statements.map((statement, index) => {
    const where = `Stmt[${String(index + 1)}]`
    const iban = requiredText(statement, 'Acct/Id/IBAN', where)
    const currency = textAt(statement, 'Acct/Ccy') ?? 'EUR'

    const opening = balanceOf(statement, ['OPBD', 'PRCD'], where)
    const closing = balanceOf(statement, ['CLBD', 'CLAV'], where)

    const sequence = textAt(statement, 'LglSeqNb') ?? textAt(statement, 'ElctrncSeqNb') ?? null
    const parsedSequence = sequence === null ? null : Number.parseInt(sequence, 10)

    const entries = childrenNamed(statement, 'Ntry').map((entry, position) =>
      entryFrom(entry, position, currency),
    )

    const fromDate = dateOf(at(statement, 'FrToDt/FrDtTm')) ?? opening.date
    const toDate = dateOf(at(statement, 'FrToDt/ToDtTm')) ?? closing.date

    if (fromDate === null || toDate === null) {
      throw new BankStatementError('No statement period and no balance dates.', where)
    }

    return {
      format: 'camt.053',
      accountIban: iban,
      currency,
      statementId: textAt(statement, 'Id'),
      sequenceNumber:
        parsedSequence !== null && Number.isFinite(parsedSequence) ? parsedSequence : null,
      openingBalance: opening.amount,
      closingBalance: closing.amount,
      openingDate: fromDate,
      closingDate: toDate,
      entries,
    }
  })
}
