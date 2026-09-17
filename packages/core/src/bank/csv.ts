import { BankStatementError, parseBankAmount, type BankEntry, type BankStatement } from './model.js'

/**
 * CSV, for the banks that export neither CAMT nor MT940 (spec 7.4).
 *
 * "Plus a configurable CSV mapper for the stragglers." Configurable is the
 * whole point: there is no CSV standard, every bank invents its own columns,
 * and a parser with a fixed layout would work for exactly one bank. So the
 * layout is **data** — a `CsvMapping` an operator sets up once per account —
 * and this module knows how to read a mapping, not how to read ING.
 *
 * It still produces the same `BankStatement` as the other two, because spec
 * 7.4 requires one transaction stream whatever the source. What it cannot
 * produce is a balance it was not given, and rather than fabricating one it
 * leaves the field null and `planImport` warns that the strongest check there
 * is cannot run.
 */

/** How the amount is written. Every bank picks one of these three. */
export type CsvAmountStyle =
  /** One signed column: `-45,50`. */
  | 'signed'
  /** Two columns, one of which is empty on any given row. */
  | 'debit_credit_columns'
  /** A magnitude plus a separate column saying which way. */
  | 'indicator'

export interface CsvMapping {
  /** `,` or `;`. Sniffed when omitted. */
  readonly delimiter: string | null
  /** Skip the first row. Almost every export has one. */
  readonly hasHeader: boolean
  /**
   * Columns by **header name** when there is a header, by zero-based index
   * otherwise. A name is used when it matches exactly, case-insensitively and
   * ignoring surrounding spaces.
   */
  readonly bookingDate: string
  readonly valueDate: string | null
  readonly amount: string
  readonly amountStyle: CsvAmountStyle
  /** For `debit_credit_columns`: the second column. */
  readonly creditAmount: string | null
  /** For `indicator`: the column, and which value means money in. */
  readonly indicator: string | null
  readonly creditIndicator: string | null
  readonly counterpartyName: string | null
  readonly counterpartyIban: string | null
  readonly description: string | null
  readonly reference: string | null
  /** A running balance after the mutation, if the bank writes one. */
  readonly balanceAfter: string | null
  /** `dd-MM-yyyy`, `yyyy-MM-dd`, `yyyyMMdd`, `dd/MM/yyyy`. */
  readonly dateFormat: string
  /** `,` for Dutch exports, `.` for the ones that follow the machines. */
  readonly decimalSeparator: string
  readonly currency: string
}

export const DEFAULT_CSV_MAPPING: CsvMapping = {
  delimiter: null,
  hasHeader: true,
  bookingDate: 'Datum',
  valueDate: null,
  amount: 'Bedrag',
  amountStyle: 'signed',
  creditAmount: null,
  indicator: null,
  creditIndicator: null,
  counterpartyName: 'Naam tegenpartij',
  counterpartyIban: 'Tegenrekening',
  description: 'Omschrijving',
  reference: null,
  balanceAfter: null,
  dateFormat: 'yyyy-MM-dd',
  decimalSeparator: ',',
  currency: 'EUR',
}

/**
 * Split a CSV into rows and fields.
 *
 * Written out rather than pulled in, because the RFC 4180 rules that matter are
 * few and the ones a library adds are not: a quoted field may contain the
 * delimiter, a newline and a doubled quote. A bank's description field contains
 * all three eventually.
 */
export function parseCsv(source: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  // A byte-order mark at the front of a Windows export otherwise becomes part
  // of the first header name, and then no column matches by name.
  const text = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  while (index < text.length) {
    const character = text[index]!

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += character
      index += 1
      continue
    }

    if (character === '"' && field === '') {
      quoted = true
      index += 1
      continue
    }
    if (character === delimiter) {
      row.push(field)
      field = ''
      index += 1
      continue
    }
    if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      index += 1
      continue
    }

    field += character
    index += 1
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ''))
}

/** Which delimiter this file uses, by counting them outside quotes. */
export function sniffDelimiter(source: string): string {
  const firstLine = source.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? ''
  const counts = [';', ',', '\t', '|'].map((candidate) => ({
    candidate,
    // Only unquoted occurrences count; a description with a comma in it is not
    // evidence of a comma-delimited file.
    count:
      firstLine
        .split(/"[^"]*"/)
        .join('')
        .split(candidate).length - 1,
  }))

  const best = counts.sort((a, b) => b.count - a.count)[0]
  return best === undefined || best.count === 0 ? ';' : best.candidate
}

function parseDate(value: string, format: string, where: string): string {
  const digits = value.trim()

  const patterns: Record<string, RegExp> = {
    'yyyy-MM-dd': /^(\d{4})-(\d{2})-(\d{2})/,
    'yyyy/MM/dd': /^(\d{4})\/(\d{2})\/(\d{2})/,
    yyyyMMdd: /^(\d{4})(\d{2})(\d{2})$/,
  }
  const reversed: Record<string, RegExp> = {
    'dd-MM-yyyy': /^(\d{2})-(\d{2})-(\d{4})$/,
    'dd/MM/yyyy': /^(\d{2})\/(\d{2})\/(\d{4})$/,
    'dd.MM.yyyy': /^(\d{2})\.(\d{2})\.(\d{4})$/,
  }

  const forward = patterns[format]
  if (forward !== undefined) {
    const match = forward.exec(digits)
    if (match !== null) return `${match[1]!}-${match[2]!}-${match[3]!}`
  }

  const backward = reversed[format]
  if (backward !== undefined) {
    const match = backward.exec(digits)
    if (match !== null) return `${match[3]!}-${match[2]!}-${match[1]!}`
  }

  throw new BankStatementError(`"${value}" is not a date in ${format}.`, where)
}

/** Resolve a column reference — a header name or an index — to a value. */
function reader(
  header: readonly string[] | null,
): (row: readonly string[], column: string) => string {
  const byName = new Map<string, number>()
  if (header !== null) {
    header.forEach((name, index) => {
      byName.set(name.trim().toLowerCase(), index)
    })
  }

  return (row, column) => {
    const named = byName.get(column.trim().toLowerCase())
    if (named !== undefined) return (row[named] ?? '').trim()

    const index = Number.parseInt(column, 10)
    if (Number.isInteger(index) && index >= 0) return (row[index] ?? '').trim()

    return ''
  }
}

function amountOf(read: (column: string) => string, mapping: CsvMapping, where: string): bigint {
  const normalise = (value: string): string =>
    mapping.decimalSeparator === ','
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '')

  if (mapping.amountStyle === 'debit_credit_columns') {
    if (mapping.creditAmount === null) {
      throw new BankStatementError('This mapping needs a credit column.', where)
    }
    const debit = read(mapping.amount)
    const credit = read(mapping.creditAmount)

    if (debit !== '' && credit !== '') {
      throw new BankStatementError('Both the debit and the credit column are filled.', where)
    }
    if (debit !== '') return -parseBankAmount(normalise(debit), where)
    if (credit !== '') return parseBankAmount(normalise(credit), where)
    throw new BankStatementError('Neither the debit nor the credit column is filled.', where)
  }

  const magnitude = parseBankAmount(normalise(read(mapping.amount)), where)

  if (mapping.amountStyle === 'indicator') {
    if (mapping.indicator === null || mapping.creditIndicator === null) {
      throw new BankStatementError('This mapping needs an indicator column and value.', where)
    }
    const indicator = read(mapping.indicator).toUpperCase()
    const incoming = indicator === mapping.creditIndicator.toUpperCase()
    // A magnitude column with a sign in it as well is a bank being unhelpful;
    // the indicator wins, because that is what it is for.
    const unsigned = magnitude < 0n ? -magnitude : magnitude
    return incoming ? unsigned : -unsigned
  }

  return magnitude
}

export interface CsvStatementOptions {
  readonly accountIban: string
  readonly mapping: CsvMapping
  /** Names the statement, since a CSV carries no identifier of its own. */
  readonly statementId?: string | null
}

export function parseBankCsv(
  source: string,
  options: CsvStatementOptions,
): readonly BankStatement[] {
  const mapping = options.mapping
  const delimiter = mapping.delimiter ?? sniffDelimiter(source)
  const rows = parseCsv(source, delimiter)

  if (rows.length === 0) throw new BankStatementError('The file is empty.', 'document')

  const header = mapping.hasHeader ? (rows[0] ?? null) : null
  const body = mapping.hasHeader ? rows.slice(1) : rows
  if (body.length === 0) {
    throw new BankStatementError('The file has a header and no rows.', 'document')
  }

  const read = reader(header)
  const entries: BankEntry[] = []
  let firstBalance: bigint | null = null
  let lastBalance: bigint | null = null
  let firstAmount = 0n

  body.forEach((row, index) => {
    const where = `row ${String(index + (mapping.hasHeader ? 2 : 1))}`
    const value = (column: string): string => read(row, column)

    const bookingDate = parseDate(value(mapping.bookingDate), mapping.dateFormat, where)
    const valueDate =
      mapping.valueDate === null || value(mapping.valueDate) === ''
        ? bookingDate
        : parseDate(value(mapping.valueDate), mapping.dateFormat, where)

    const amount = amountOf(value, mapping, where)
    if (amount === 0n) {
      throw new BankStatementError('A statement line of zero is not a mutation.', where)
    }

    if (mapping.balanceAfter !== null) {
      const raw = value(mapping.balanceAfter)
      if (raw !== '') {
        const normalised =
          mapping.decimalSeparator === ','
            ? raw.replace(/\./g, '').replace(',', '.')
            : raw.replace(/,/g, '')
        const balance = parseBankAmount(normalised, where)
        if (firstBalance === null) {
          firstBalance = balance
          firstAmount = amount
        }
        lastBalance = balance
      }
    }

    entries.push({
      amount,
      currency: mapping.currency,
      bookingDate,
      valueDate,
      // A CSV has no bank reference worth trusting as a unique key, so the
      // content hash does the deduplication. See `dedupeKey`.
      bankReference: null,
      endToEndId: null,
      counterpartyName:
        mapping.counterpartyName === null || value(mapping.counterpartyName) === ''
          ? null
          : value(mapping.counterpartyName),
      counterpartyIban:
        mapping.counterpartyIban === null || value(mapping.counterpartyIban) === ''
          ? null
          : value(mapping.counterpartyIban).replace(/\s/g, '').toUpperCase(),
      description: mapping.description === null ? '' : value(mapping.description),
      remittanceReference:
        mapping.reference === null || value(mapping.reference) === ''
          ? null
          : value(mapping.reference),
      transactionCode: null,
      raw: row.join(delimiter),
    })
  })

  const dates = entries.map((entry) => entry.bookingDate).sort((a, b) => a.localeCompare(b))

  return [
    {
      format: 'csv',
      accountIban: options.accountIban,
      currency: mapping.currency,
      statementId: options.statementId ?? null,
      // A CSV has no sequence number, which `planImport` warns about: from here
      // on a missing statement cannot be detected.
      sequenceNumber: null,
      /**
       * Derived from the running balance when the bank wrote one, and null
       * otherwise. The opening balance is the balance after the first mutation
       * minus that mutation, which is the only way to recover it from a column
       * that only ever says "after".
       */
      openingBalance: firstBalance === null ? null : firstBalance - firstAmount,
      closingBalance: lastBalance,
      openingDate: dates[0] ?? '',
      closingDate: dates.at(-1) ?? '',
      entries,
    },
  ]
}

/**
 * A first guess at a mapping, from the header row.
 *
 * Not a substitute for configuring one: it is what turns "fill in eleven
 * fields" into "check eight and correct three". The names are the ones ING,
 * Rabobank, ABN AMRO, SNS and Bunq actually use.
 */
const HEADER_HINTS: Readonly<Record<keyof CsvMapping, readonly string[]>> = {
  bookingDate: ['datum', 'boekdatum', 'transactiedatum', 'date', 'transactiondate'],
  valueDate: ['rentedatum', 'valutadatum', 'valuedate'],
  amount: ['bedrag', 'bedrag (eur)', 'amount', 'transactiebedrag', 'bedrag eur'],
  counterpartyName: ['naam tegenpartij', 'naam', 'tegenpartij', 'name', 'naam / omschrijving'],
  counterpartyIban: [
    'tegenrekening',
    'tegenrekening iban/bban',
    'iban tegenpartij',
    'counterparty',
  ],
  description: ['omschrijving', 'omschrijving-1', 'mededelingen', 'description', 'notificaties'],
  reference: ['kenmerk', 'betalingskenmerk', 'reference'],
  balanceAfter: ['saldo na mutatie', 'saldo', 'balance'],
  indicator: ['af bij', 'af/bij', 'debet/credit', 'debit/credit'],
  delimiter: [],
  hasHeader: [],
  amountStyle: [],
  creditAmount: [],
  creditIndicator: [],
  dateFormat: [],
  decimalSeparator: [],
  currency: [],
}

export interface MappingGuess {
  readonly mapping: CsvMapping
  readonly header: readonly string[]
  /** Columns the guess could not place, so the operator knows what is left. */
  readonly unmatched: readonly string[]
}

export function guessCsvMapping(source: string): MappingGuess {
  const delimiter = sniffDelimiter(source)
  const rows = parseCsv(source, delimiter)
  const header = rows[0] ?? []
  const sample = rows[1] ?? []

  const find = (field: keyof CsvMapping): string | null => {
    const hints = HEADER_HINTS[field]
    const found = header.find((name) => hints.includes(name.trim().toLowerCase()))
    return found ?? null
  }

  const indicator = find('indicator')
  const amount = find('amount') ?? header[0] ?? '0'
  const bookingDate = find('bookingDate') ?? header[0] ?? '0'

  // A `1.234,56` sample is Dutch; `1,234.56` or `1234.56` is not.
  const amountSample = sample[header.indexOf(amount)] ?? ''
  const decimalSeparator = /,\d{1,2}(\D|$)/.test(amountSample) ? ',' : '.'

  const dateSample = sample[header.indexOf(bookingDate)] ?? ''
  const dateFormat = /^\d{4}-\d{2}-\d{2}/.test(dateSample)
    ? 'yyyy-MM-dd'
    : /^\d{8}$/.test(dateSample)
      ? 'yyyyMMdd'
      : /^\d{2}-\d{2}-\d{4}$/.test(dateSample)
        ? 'dd-MM-yyyy'
        : /^\d{2}\/\d{2}\/\d{4}$/.test(dateSample)
          ? 'dd/MM/yyyy'
          : 'yyyy-MM-dd'

  const mapping: CsvMapping = {
    delimiter,
    hasHeader: true,
    bookingDate,
    valueDate: find('valueDate'),
    amount,
    amountStyle: indicator === null ? 'signed' : 'indicator',
    creditAmount: null,
    indicator,
    // ING writes "Bij" for money in; the rest use "C" or "Credit".
    creditIndicator: indicator === null ? null : 'BIJ',
    counterpartyName: find('counterpartyName'),
    counterpartyIban: find('counterpartyIban'),
    description: find('description'),
    reference: find('reference'),
    balanceAfter: find('balanceAfter'),
    dateFormat,
    decimalSeparator,
    currency: 'EUR',
  }

  const placed = new Set(
    [
      mapping.bookingDate,
      mapping.valueDate,
      mapping.amount,
      mapping.indicator,
      mapping.counterpartyName,
      mapping.counterpartyIban,
      mapping.description,
      mapping.reference,
      mapping.balanceAfter,
    ].filter((name): name is string => name !== null),
  )

  return {
    mapping,
    header,
    unmatched: header.filter((name) => !placed.has(name)),
  }
}
