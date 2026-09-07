import { BankStatementError, parseBankAmount, type BankEntry, type BankStatement } from './model.js'

/**
 * MT940, the format every Dutch bank still exports (spec 7.4).
 *
 * "Every Dutch bank exports these, no licence, no fee, no dependency." That is
 * the whole reason it is here, and it is also why it is unpleasant: MT940 is a
 * telex format from the 1970s that each bank extended differently, and the part
 * that carries the counterparty — `:86:` — is explicitly free text.
 *
 * So the rule is: **parse what is structured, keep what is not.** The tags
 * themselves are standard and are read strictly. The `:86:` block is scanned
 * for the subfield conventions ING, Rabobank and ABN AMRO actually use, and
 * whatever is left over becomes the description rather than being discarded.
 */

/** `:61:` — value date, optional entry date, D/C mark, amount, type, references. */
const STATEMENT_LINE =
  /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d[\d,]*)([A-Z]\w{3})([^/\n]{0,16})(?:\/\/(\S{0,16}))?/

/** ING and many others: `/EREF/…/IBAN/…/NAME/…/REMI/…` run together. */
const SUBFIELD = /\/([A-Z]{2,8})\/((?:(?!\/[A-Z]{2,8}\/)[\s\S])*)/g

function yymmdd(value: string, where: string): string {
  const year = Number(value.slice(0, 2))
  const month = value.slice(2, 4)
  const day = value.slice(4, 6)
  // A two-digit year in a bank statement is this century. The alternative is a
  // sliding window, which would put a 1970s statement in 2070 anyway.
  const full = 2000 + year
  const iso = `${String(full)}-${month}-${day}`
  if (Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
    throw new BankStatementError(`"${value}" is not a date.`, where)
  }
  return iso
}

/** `:60F:` and friends — mark, date, currency, amount. */
function parseBalance(
  value: string,
  where: string,
): { date: string; currency: string; amount: bigint } {
  const match = /^([CD])(\d{6})([A-Z]{3})([\d,.]+)$/.exec(value.trim())
  if (match === null) throw new BankStatementError(`"${value}" is not a balance.`, where)

  const magnitude = parseBankAmount(match[4]!, where)
  return {
    date: yymmdd(match[2]!, where),
    currency: match[3]!,
    // A `D` balance is an overdraft, which is a negative balance.
    amount: match[1] === 'D' ? -magnitude : magnitude,
  }
}

interface Subfields {
  readonly named: Readonly<Record<string, string>>
  readonly rest: string
}

/**
 * Pull `/TAG/value` pairs out of an `:86:` block.
 *
 * Everything before the first tag, and any block with no tags at all, is the
 * leftover — which for ABN AMRO is the entire useful content. Dropping it
 * because it was not structured would lose the only description the bank gave.
 */
function readSubfields(block: string): Subfields {
  const named: Record<string, string> = {}
  const firstTag = block.search(/\/[A-Z]{2,8}\//)

  if (firstTag === -1) return { named, rest: block.trim() }

  SUBFIELD.lastIndex = 0
  let match: RegExpExecArray | null
  const tagged = block.slice(firstTag)
  while ((match = SUBFIELD.exec(tagged)) !== null) {
    const tag = match[1] ?? ''
    const value = (match[2] ?? '').trim()
    // Repeated tags concatenate; REMI often arrives in several pieces.
    named[tag] = named[tag] === undefined ? value : `${named[tag]} ${value}`
  }

  return { named, rest: block.slice(0, firstTag).trim() }
}

function entryFrom(line: string, information: string, currency: string): BankEntry {
  const where = ':61:'
  const match = STATEMENT_LINE.exec(line)
  if (match === null) throw new BankStatementError(`Cannot read "${line}".`, where)

  const [, valueDate, entryDate, mark, , amount, code, rawOwnerReference, bankReference] = match
  const magnitude = parseBankAmount(amount!, where)

  // C is a credit to the account — money in. RC and RD are reversals, and a
  // reversed credit is money going out again.
  const incoming = mark === 'C' || mark === 'RD'
  const booking =
    entryDate === undefined
      ? yymmdd(valueDate!, where)
      : yymmdd(`${valueDate!.slice(0, 2)}${entryDate}`, where)

  const ownerReference = rawOwnerReference?.trim()
  const { named, rest } = readSubfields(information)
  const remittance = [named['REMI'], named['SVWZ'], rest].filter(
    (part) => part !== undefined && part !== '',
  )

  return {
    amount: incoming ? magnitude : -magnitude,
    currency,
    bookingDate: booking,
    valueDate: yymmdd(valueDate!, where),
    bankReference: bankReference === undefined || bankReference === '' ? null : bankReference,
    endToEndId: named['EREF'] ?? null,
    counterpartyName: named['NAME'] ?? named['ABWA'] ?? null,
    counterpartyIban: named['IBAN'] ?? named['CNTP']?.split('/')[0] ?? null,
    description: remittance.join(' ').replace(/\s+/g, ' ').trim(),
    /**
     * `:61:` subfield 6 is the reference for the account owner, and for a
     * received payment it is very often the invoice number the payer typed.
     * `NONREF` is the standard way of saying there isn't one.
     */
    remittanceReference:
      named['CREF'] ??
      named['KREF'] ??
      (ownerReference === undefined || ownerReference === '' || ownerReference === 'NONREF'
        ? null
        : ownerReference),
    transactionCode: code ?? null,
    raw: `${line}\n${information}`.trim(),
  }
}

/**
 * Read one MT940 file.
 *
 * A file may hold several statements — one per day is normal — separated by a
 * lone `-`. Every one is returned: silently keeping the first is how a week of
 * transactions goes missing.
 */
export function parseMt940(source: string): readonly BankStatement[] {
  const normalised = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalised
    .split(/^\s*-\s*$/m)
    .map((block) => block.trim())
    .filter((block) => block !== '')

  if (blocks.length === 0) throw new BankStatementError('The file is empty.', 'document')

  return blocks.map((block, index) => parseStatement(block, index))
}

function parseStatement(block: string, index: number): BankStatement {
  const where = `statement ${String(index + 1)}`

  // Tags start a line with `:NN…:`; anything else continues the previous one.
  const fields: { tag: string; value: string }[] = []
  for (const line of block.split('\n')) {
    const match = /^:(\d{2}[A-Z]?):(.*)$/.exec(line)
    if (match !== null) fields.push({ tag: match[1]!, value: match[2] ?? '' })
    else if (fields.length > 0) fields[fields.length - 1]!.value += `\n${line}`
  }

  const first = (tag: string): string | null =>
    fields.find((field) => field.tag === tag)?.value.trim() ?? null

  const account = first('25')
  if (account === null) throw new BankStatementError('No :25: account.', where)

  const opening = first('60F') ?? first('60M')
  const closing = first('62F') ?? first('62M')
  if (opening === null) throw new BankStatementError('No :60F: opening balance.', where)
  if (closing === null) throw new BankStatementError('No :62F: closing balance.', where)

  const open = parseBalance(opening, `${where} :60F:`)
  const close = parseBalance(closing, `${where} :62F:`)

  // `:28C:` is `statement/sequence`. The statement number is the one that
  // increments per account; the sequence is a page within it.
  const statementNumber = first('28C') ?? first('28')
  const sequence = statementNumber === null ? null : Number.parseInt(statementNumber, 10)

  const entries: BankEntry[] = []
  for (let position = 0; position < fields.length; position += 1) {
    const field = fields[position]!
    if (field.tag !== '61') continue
    const next = fields[position + 1]
    const information = next !== undefined && next.tag === '86' ? next.value : ''
    entries.push(entryFrom(field.value.trim(), information, close.currency))
  }

  return {
    format: 'mt940',
    // `:25:` is often `NL02ABNA0123456789 EUR` or has a bank code prefix.
    accountIban: account.split(/[\s/]/)[0] ?? account,
    currency: close.currency,
    statementId: first('20'),
    sequenceNumber: sequence !== null && Number.isFinite(sequence) ? sequence : null,
    openingBalance: open.amount,
    closingBalance: close.amount,
    openingDate: open.date,
    closingDate: close.date,
    entries,
  }
}
