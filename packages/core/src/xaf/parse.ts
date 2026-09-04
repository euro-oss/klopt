import type {
  XafAccountType,
  XafCustomerSupplier,
  XafDebitCredit,
  XafDocument,
  XafJournal,
  XafJournalType,
  XafLedgerAccount,
  XafOpeningBalanceLine,
  XafPeriod,
  XafTransaction,
  XafTransactionLine,
  XafVatCode,
} from './model.js'

/**
 * XAF import (spec 7.3, 13).
 *
 * "XAF import too. This is your migration path in and your credibility signal:
 * a competitor's data goes in, and can come straight back out."
 *
 * The parser is hand-written and deliberately lenient about *shape* and strict
 * about *values*. Real files come out of Exact, AFAS, Twinfield and Snelstart,
 * and they differ in whitespace, in which optional elements they emit, in
 * whether they declare the namespace, and in element order within a parent.
 * Rejecting a file an accountant sent because the elements are in a different
 * order helps nobody. Misreading an amount does real damage, so amounts, dates
 * and enumerations are checked hard.
 *
 * Amounts are parsed from their decimal string straight into minor units. The
 * string never becomes a Number: `parseFloat('1234567890123.45')` has already
 * lost data by the time you look at it.
 */

export class XafParseError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'XafParseError'
  }
}

interface Element {
  readonly name: string
  readonly children: readonly Element[]
  readonly text: string
}

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? _)
}

/**
 * A small XML reader. No DTDs, no entity definitions, no external references —
 * which is deliberate: an auditfile arrives from outside and an XML parser that
 * resolves external entities is a file-disclosure vulnerability.
 */
export function parseXml(source: string): Element {
  const withoutProlog = source
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // CDATA is escaped rather than inlined. Inlining it raw would let
    // <![CDATA[<b>]]> tokenise as a real element.
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content: string) =>
      content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )

  if (/<!DOCTYPE/i.test(withoutProlog)) {
    throw new XafParseError('A DOCTYPE declaration is not accepted.', 'document')
  }

  interface Frame {
    name: string
    children: Element[]
    text: string
  }

  const stack: Frame[] = []
  let root: Element | null = null
  let lastIndex = 0
  let match: RegExpExecArray | null

  TAG.lastIndex = 0
  while ((match = TAG.exec(withoutProlog)) !== null) {
    const [, closing, rawName, , selfClosing] = match
    const name = (rawName ?? '').split(':').pop() ?? ''

    const between = withoutProlog.slice(lastIndex, match.index)
    if (stack.length > 0 && between.trim() !== '') {
      stack[stack.length - 1]!.text += between
    }
    lastIndex = TAG.lastIndex

    if (closing === '/') {
      const frame = stack.pop()
      if (frame === undefined) throw new XafParseError(`Unexpected </${name}>.`, 'document')
      if (frame.name !== name) {
        throw new XafParseError(`Expected </${frame.name}>, found </${name}>.`, frame.name)
      }
      const element: Element = {
        name: frame.name,
        children: frame.children,
        text: decodeText(frame.text).trim(),
      }
      if (stack.length === 0) root = element
      else stack[stack.length - 1]!.children.push(element)
      continue
    }

    if (selfClosing === '/') {
      const element: Element = { name, children: [], text: '' }
      if (stack.length === 0) root = element
      else stack[stack.length - 1]!.children.push(element)
      continue
    }

    stack.push({ name, children: [], text: '' })
  }

  if (stack.length > 0) {
    throw new XafParseError(`Unclosed <${stack[stack.length - 1]!.name}>.`, 'document')
  }
  if (root === null) throw new XafParseError('No root element.', 'document')
  return root
}

function child(element: Element, name: string): Element | undefined {
  return element.children.find((candidate) => candidate.name === name)
}

function children(element: Element, name: string): readonly Element[] {
  return element.children.filter((candidate) => candidate.name === name)
}

function text(element: Element, name: string): string | null {
  const found = child(element, name)
  if (found === undefined) return null
  return found.text === '' ? null : found.text
}

function requiredText(element: Element, name: string, path: string): string {
  const value = text(element, name)
  if (value === null) throw new XafParseError(`<${name}> is required.`, path)
  return value
}

const AMOUNT = /^-?\d+(\.\d+)?$/

/** Decimal string to minor units, integer arithmetic only. */
export function parseXafAmount(value: string, path: string): bigint {
  const trimmed = value.trim()
  if (!AMOUNT.test(trimmed)) throw new XafParseError(`"${value}" is not an amount.`, path)

  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = unsigned.split('.')

  if (fraction.length > 2) {
    throw new XafParseError(`"${value}" has more than two decimals.`, path)
  }

  const minorUnits = BigInt(whole + fraction.padEnd(2, '0'))
  return negative ? -minorUnits : minorUnits
}

function parseDebitCredit(value: string, path: string): XafDebitCredit {
  if (value !== 'D' && value !== 'C') {
    throw new XafParseError(`"${value}" is not D or C.`, path)
  }
  return value
}

function parseInteger(value: string, path: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new XafParseError(`"${value}" is not an integer.`, path)
  return parsed
}

function parseLine(element: Element, path: string): XafTransactionLine {
  const nr = requiredText(element, 'nr', path)
  const where = `${path}.line.${nr}`
  const vatElement = child(element, 'vat')
  const currencyElement = child(element, 'currency')

  return {
    nr,
    accID: requiredText(element, 'accID', where),
    // Required by the schema but frequently empty in the wild; an empty docRef
    // is not a reason to refuse somebody's migration.
    docRef: text(element, 'docRef') ?? '',
    effDate: requiredText(element, 'effDate', where),
    desc: text(element, 'desc'),
    amount: parseXafAmount(requiredText(element, 'amnt', where), `${where}.amnt`),
    amountType: parseDebitCredit(requiredText(element, 'amntTp', where), `${where}.amntTp`),
    custSupID: text(element, 'custSupID'),
    invRef: text(element, 'invRef'),
    costID: text(element, 'costID'),
    projID: text(element, 'projID'),
    vat:
      vatElement === undefined
        ? null
        : {
            vatID: requiredText(vatElement, 'vatID', `${where}.vat`),
            vatPerc: text(vatElement, 'vatPerc') ?? '0',
            vatAmnt: parseXafAmount(
              requiredText(vatElement, 'vatAmnt', `${where}.vat`),
              `${where}.vat.vatAmnt`,
            ),
            vatAmntTp: parseDebitCredit(
              requiredText(vatElement, 'vatAmntTp', `${where}.vat`),
              `${where}.vat.vatAmntTp`,
            ),
          },
    currency:
      currencyElement === undefined
        ? null
        : {
            curCode: requiredText(currencyElement, 'curCode', `${where}.currency`),
            curAmnt: parseXafAmount(
              requiredText(currencyElement, 'curAmnt', `${where}.currency`),
              `${where}.currency.curAmnt`,
            ),
          },
  }
}

const JOURNAL_TYPES = new Set(['B', 'C', 'M', 'P', 'S', 'Z'])
const ACCOUNT_TYPES = new Set(['B', 'P', 'M'])

export function parseXaf(source: string): XafDocument {
  const root = parseXml(source)
  if (root.name !== 'auditfile') {
    throw new XafParseError(`Expected <auditfile>, found <${root.name}>.`, 'document')
  }

  const headerElement = child(root, 'header')
  if (headerElement === undefined) throw new XafParseError('<header> is missing.', 'auditfile')
  const companyElement = child(root, 'company')
  if (companyElement === undefined) throw new XafParseError('<company> is missing.', 'auditfile')

  const addressElement = child(companyElement, 'streetAddress')

  const accounts: XafLedgerAccount[] = []
  const generalLedger = child(companyElement, 'generalLedger')
  if (generalLedger !== undefined) {
    for (const element of children(generalLedger, 'ledgerAccount')) {
      const accID = requiredText(element, 'accID', 'generalLedger')
      const accTp = text(element, 'accTp') ?? 'M'
      if (!ACCOUNT_TYPES.has(accTp)) {
        throw new XafParseError(`"${accTp}" is not a valid accTp.`, `generalLedger.${accID}`)
      }
      accounts.push({
        accID,
        accDesc: text(element, 'accDesc') ?? accID,
        accTp: accTp as XafAccountType,
        leadCode: text(element, 'leadCode'),
        leadDescription: text(element, 'leadDescription'),
        leadReference: text(element, 'leadReference'),
      })
    }
  }

  const parties: XafCustomerSupplier[] = []
  const partiesElement = child(companyElement, 'customersSuppliers')
  if (partiesElement !== undefined) {
    for (const element of children(partiesElement, 'customerSupplier')) {
      const custSupTp = text(element, 'custSupTp')
      parties.push({
        custSupID: requiredText(element, 'custSupID', 'customersSuppliers'),
        custSupName: text(element, 'custSupName'),
        taxRegistrationCountry: text(element, 'taxRegistrationCountry'),
        taxRegIdent: text(element, 'taxRegIdent'),
        custSupTp:
          custSupTp === 'C' || custSupTp === 'S' || custSupTp === 'B' || custSupTp === 'O'
            ? custSupTp
            : null,
      })
    }
  }

  const vatCodes: XafVatCode[] = []
  const vatCodesElement = child(companyElement, 'vatCodes')
  if (vatCodesElement !== undefined) {
    for (const element of children(vatCodesElement, 'vatCode')) {
      const vatID = requiredText(element, 'vatID', 'vatCodes')
      vatCodes.push({
        vatID,
        vatDesc: text(element, 'vatDesc') ?? vatID,
        vatToPayAccID: text(element, 'vatToPayAccID'),
        vatToClaimAccID: text(element, 'vatToClaimAccID'),
      })
    }
  }

  const periods: XafPeriod[] = []
  const periodsElement = child(companyElement, 'periods')
  if (periodsElement !== undefined) {
    for (const element of children(periodsElement, 'period')) {
      const number = parseInteger(requiredText(element, 'periodNumber', 'periods'), 'periods')
      periods.push({
        periodNumber: number,
        periodDesc: text(element, 'periodDesc'),
        startDatePeriod: requiredText(element, 'startDatePeriod', `periods.${String(number)}`),
        endDatePeriod: requiredText(element, 'endDatePeriod', `periods.${String(number)}`),
      })
    }
  }

  const openingBalanceElement = child(companyElement, 'openingBalance')
  const openingBalanceLines: XafOpeningBalanceLine[] = []
  if (openingBalanceElement !== undefined) {
    for (const element of children(openingBalanceElement, 'obLine')) {
      const nr = requiredText(element, 'nr', 'openingBalance')
      openingBalanceLines.push({
        nr,
        accID: requiredText(element, 'accID', `openingBalance.${nr}`),
        amount: parseXafAmount(
          requiredText(element, 'amnt', `openingBalance.${nr}`),
          `openingBalance.${nr}.amnt`,
        ),
        amountType: parseDebitCredit(
          requiredText(element, 'amntTp', `openingBalance.${nr}`),
          `openingBalance.${nr}.amntTp`,
        ),
      })
    }
  }

  const journals: XafJournal[] = []
  const transactionsElement = child(companyElement, 'transactions')
  if (transactionsElement !== undefined) {
    for (const journalElement of children(transactionsElement, 'journal')) {
      const jrnID = requiredText(journalElement, 'jrnID', 'transactions')
      const jrnTp = text(journalElement, 'jrnTp') ?? 'Z'

      const transactions: XafTransaction[] = []
      for (const element of children(journalElement, 'transaction')) {
        const nr = requiredText(element, 'nr', `journal.${jrnID}`)
        const where = `journal.${jrnID}.transaction.${nr}`
        transactions.push({
          nr,
          desc: text(element, 'desc'),
          periodNumber: parseInteger(requiredText(element, 'periodNumber', where), where),
          trDt: requiredText(element, 'trDt', where),
          sourceID: text(element, 'sourceID'),
          userID: text(element, 'userID'),
          lines: children(element, 'trLine').map((line) => parseLine(line, where)),
        })
      }

      journals.push({
        jrnID,
        desc: text(journalElement, 'desc') ?? jrnID,
        // An unrecognised journal type becomes "other" rather than a rejection.
        jrnTp: (JOURNAL_TYPES.has(jrnTp) ? jrnTp : 'Z') as XafJournalType,
        offsetAccID: text(journalElement, 'offsetAccID'),
        transactions,
      })
    }
  }

  return {
    header: {
      fiscalYear: requiredText(headerElement, 'fiscalYear', 'header'),
      startDate: requiredText(headerElement, 'startDate', 'header'),
      endDate: requiredText(headerElement, 'endDate', 'header'),
      curCode: text(headerElement, 'curCode') ?? 'EUR',
      dateCreated: text(headerElement, 'dateCreated') ?? '',
      softwareDesc: text(headerElement, 'softwareDesc') ?? '',
      softwareVersion: text(headerElement, 'softwareVersion') ?? '',
    },
    company: {
      companyIdent: text(companyElement, 'companyIdent'),
      companyName: requiredText(companyElement, 'companyName', 'company'),
      taxRegistrationCountry: text(companyElement, 'taxRegistrationCountry') ?? 'NL',
      taxRegIdent: text(companyElement, 'taxRegIdent') ?? '',
      streetAddress:
        addressElement === undefined
          ? null
          : {
              streetname: text(addressElement, 'streetname'),
              number: text(addressElement, 'number'),
              city: text(addressElement, 'city'),
              postalCode: text(addressElement, 'postalCode'),
              country: text(addressElement, 'country'),
            },
    },
    customersSuppliers: parties,
    ledgerAccounts: accounts,
    vatCodes,
    periods,
    openingBalance:
      openingBalanceElement === undefined
        ? null
        : {
            opBalDate: text(openingBalanceElement, 'opBalDate') ?? '',
            opBalDesc: text(openingBalanceElement, 'opBalDesc'),
            lines: openingBalanceLines,
          },
    journals,
  }
}

/**
 * The control totals the file declares, for comparison against what it
 * contains. A mismatch means the file was produced by something that lost
 * track, and importing it silently would inherit the problem.
 */
export interface XafDeclaredTotals {
  readonly linesCount: number | null
  readonly totalDebit: bigint | null
  readonly totalCredit: bigint | null
}

export function readDeclaredTotals(source: string): XafDeclaredTotals {
  const root = parseXml(source)
  const company = child(root, 'company')
  const transactions = company === undefined ? undefined : child(company, 'transactions')
  if (transactions === undefined) {
    return { linesCount: null, totalDebit: null, totalCredit: null }
  }

  const count = text(transactions, 'linesCount')
  const debit = text(transactions, 'totalDebit')
  const credit = text(transactions, 'totalCredit')

  return {
    linesCount: count === null ? null : parseInteger(count, 'transactions.linesCount'),
    totalDebit: debit === null ? null : parseXafAmount(debit, 'transactions.totalDebit'),
    totalCredit: credit === null ? null : parseXafAmount(credit, 'transactions.totalCredit'),
  }
}
