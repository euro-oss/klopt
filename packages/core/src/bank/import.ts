import { createHash } from 'node:crypto'
import { BankStatementError, type BankEntry, type BankStatement } from './model.js'
import { parseCamt053 } from './camt.js'
import { parseMt940 } from './mt940.js'

/**
 * Getting a statement in without importing it twice (spec 7.4).
 *
 * Three rules, and each exists because of a specific way a bank balance goes
 * quietly wrong:
 *
 * **Deduplicate on the bank's reference, with a content hash as fallback.** A
 * reference the bank supplies is unique within the account and survives a
 * re-export; a hash of the content does not. Two identical card payments of the
 * same amount on the same day are a real thing, and hashing them together would
 * drop one. So the hash includes the entry's position within its statement,
 * which makes it stable for a re-import of the same file and still distinct for
 * two genuinely different entries that happen to look alike.
 *
 * **Detect gaps in the statement sequence.** "A missing statement is a silently
 * wrong balance": the closing balance of statement 41 and the opening balance
 * of 43 will not agree, and nothing else in the system will notice.
 *
 * **Check the balance walk.** Opening plus the entries must equal closing. When
 * it does not, the file is truncated or misparsed, and importing it anyway puts
 * a wrong balance in front of somebody who will trust it.
 */

export type BankFileFormat = 'camt.053' | 'mt940' | 'csv'

/**
 * Sniff the format. A bank names its downloads whatever it likes.
 *
 * CAMT and MT940 are recognisable from their first bytes. Everything else that
 * looks like delimited text is reported as `csv` — which is not a guess about
 * *which* CSV, only that a mapping will be needed. Making the caller declare
 * the obvious would be a form field that is wrong as often as it is right.
 */
export function detectBankFormat(source: string): BankFileFormat {
  const head = source.slice(0, 4096)
  if (/^\s*<\?xml|<Document|BkToCstmrStmt/i.test(head)) return 'camt.053'
  if (/^\s*(\{1:|:20:|:25:|:940:)/m.test(head) || /^:\d{2}[A-Z]?:/m.test(head)) return 'mt940'

  const firstLine = head.split(/\r?\n/)[0] ?? ''
  if (/[;,\t|]/.test(firstLine) && firstLine.trim() !== '') return 'csv'

  throw new BankStatementError(
    'Not recognisable as CAMT.053, MT940 or a delimited file.',
    'document',
  )
}

/**
 * Parse one of the two self-describing formats.
 *
 * A CSV is refused here on purpose: it needs a mapping, which this function has
 * no way to accept, and silently returning nothing would be worse.
 */
export function parseBankFile(source: string, format?: BankFileFormat): readonly BankStatement[] {
  const chosen = format ?? detectBankFormat(source)

  if (chosen === 'csv') {
    throw new BankStatementError(
      'A delimited file needs a column mapping. Use parseBankCsv.',
      'document',
    )
  }

  return chosen === 'camt.053' ? parseCamt053(source) : parseMt940(source)
}

/**
 * The key an entry is deduplicated on.
 *
 * The bank's reference when it gave one, prefixed so it can never collide with
 * a hash, and otherwise a hash of the fields that identify the entry plus its
 * position in the statement. See the note above for why position is in there.
 */
export function dedupeKey(
  entry: BankEntry,
  statement: { accountIban: string; statementId: string | null; sequenceNumber: number | null },
  position: number,
): string {
  if (entry.bankReference !== null && entry.bankReference.trim() !== '') {
    return `ref:${entry.bankReference.trim()}`
  }

  const canonical = [
    statement.accountIban,
    statement.statementId ?? '',
    statement.sequenceNumber === null ? '' : String(statement.sequenceNumber),
    String(position),
    entry.bookingDate,
    entry.valueDate,
    entry.amount.toString(),
    entry.currency,
    entry.counterpartyIban ?? '',
    entry.counterpartyName ?? '',
    entry.description,
  ].join('\x1f')

  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

export interface StatementProblem {
  readonly severity: 'error' | 'warning'
  readonly code:
    | 'balance_walk_mismatch'
    | 'no_balance_declared'
    | 'sequence_gap'
    | 'no_sequence_number'
    | 'account_mismatch'
    | 'currency_mismatch'
  readonly message: string
}

export interface PlannedEntry {
  readonly entry: BankEntry
  readonly dedupeKey: string
  readonly position: number
}

export interface StatementPlan {
  readonly statement: BankStatement
  readonly entries: readonly PlannedEntry[]
  readonly problems: readonly StatementProblem[]
}

export interface ImportPlan {
  readonly statements: readonly StatementPlan[]
  readonly problems: readonly StatementProblem[]
  /** Every key in the file, so the caller can ask the database what it has. */
  readonly dedupeKeys: readonly string[]
}

export interface ImportContext {
  /** The account being imported into, to catch a file for the wrong one. */
  readonly accountIban: string
  readonly currency: string
  /** The highest sequence number already imported, for the gap check. */
  readonly lastSequenceNumber: number | null
}

/** IBANs are compared without spaces and without case. Banks print them both ways. */
export function normaliseIban(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

/**
 * What importing this file would do, and everything wrong with it.
 *
 * Nothing is written and nothing is decided about duplicates: that needs the
 * database. This is the part worth testing without one.
 */
export function planImport(
  statements: readonly BankStatement[],
  context: ImportContext,
): ImportPlan {
  const problems: StatementProblem[] = []
  const planned: StatementPlan[] = []
  const keys: string[] = []

  // Sorted, so a file whose statements arrive out of order still produces a
  // sensible gap report.
  const ordered = [...statements].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
  let previous = context.lastSequenceNumber

  for (const statement of ordered) {
    const own: StatementProblem[] = []
    const where = statement.statementId ?? statement.closingDate

    if (normaliseIban(statement.accountIban) !== normaliseIban(context.accountIban)) {
      own.push({
        severity: 'error',
        code: 'account_mismatch',
        message: `Statement ${where} is for ${statement.accountIban}, not ${context.accountIban}.`,
      })
    }

    if (statement.currency !== context.currency) {
      own.push({
        severity: 'error',
        code: 'currency_mismatch',
        message: `Statement ${where} is in ${statement.currency}, the account is in ${context.currency}.`,
      })
    }

    if (statement.openingBalance === null || statement.closingBalance === null) {
      /**
       * No balances, so the strongest check there is cannot run.
       *
       * A warning rather than a refusal: a CSV with no balance column is still
       * worth importing, and refusing it would leave the operator with nothing.
       * But it is worth saying out loud, because from here on a missing line is
       * undetectable.
       */
      own.push({
        severity: 'warning',
        code: 'no_balance_declared',
        message:
          `Statement ${where} declares no balances, so it cannot be checked against its ` +
          'entries. A missing line in this file would go unnoticed.',
      })
    } else {
      const walked = statement.entries.reduce(
        (sum, entry) => sum + entry.amount,
        statement.openingBalance,
      )
      if (walked !== statement.closingBalance) {
        own.push({
          severity: 'error',
          code: 'balance_walk_mismatch',
          message:
            `Statement ${where} does not add up: opening plus entries is ` +
            `${walked.toString()}, the file says ${statement.closingBalance.toString()}. ` +
            'The file is truncated or was misread.',
        })
      }
    }

    if (statement.sequenceNumber === null) {
      own.push({
        severity: 'warning',
        code: 'no_sequence_number',
        message: `Statement ${where} carries no sequence number, so a missing statement cannot be detected.`,
      })
    } else if (previous !== null && statement.sequenceNumber > previous + 1) {
      own.push({
        severity: 'warning',
        code: 'sequence_gap',
        message:
          `Statements ${String(previous + 1)} to ${String(statement.sequenceNumber - 1)} are ` +
          'missing. A missing statement is a silently wrong balance.',
      })
    }

    if (statement.sequenceNumber !== null) previous = statement.sequenceNumber

    const entries = statement.entries.map((entry, position) => ({
      entry,
      position,
      dedupeKey: dedupeKey(entry, statement, position),
    }))
    for (const item of entries) keys.push(item.dedupeKey)

    planned.push({ statement, entries, problems: own })
    problems.push(...own)
  }

  return { statements: planned, problems, dedupeKeys: keys }
}
