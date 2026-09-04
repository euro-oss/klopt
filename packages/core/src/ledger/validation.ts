import { violation, type LedgerViolation } from '../errors.js'
import type { CurrencyCode } from '../money.js'
import type {
  DimensionAssignment,
  JournalLineInput,
  PostJournalEntryCommand,
  PostedJournalLine,
} from './types.js'

/**
 * Pure posting rules. No database, no clock, no transaction — every rule here
 * is a function of its arguments, so the property tests in
 * test/ledger/posting.test.ts run in milliseconds against thousands of random
 * entries rather than against an HTTP handler.
 *
 * The database enforces the same invariants independently (see the constraint
 * triggers in packages/db/migrations). That duplication is deliberate: the
 * application gives a good error message, the database makes the invariant true
 * even for a connection that never went through the application.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // Round-trip: rejects 2026-02-30, which Date happily rolls over.
  return parsed.toISOString().slice(0, 10) === value
}

const RATE_PATTERN = /^\d+(\.\d+)?$/

export function isValidExchangeRate(value: string): boolean {
  return RATE_PATTERN.test(value) && /[1-9]/.test(value)
}

/**
 * One canonical spelling for a decimal, so `1.5`, `1.50` and `01.500` are the
 * same string by the time anything hashes it.
 *
 * This is not cosmetic. Postgres stores an exchange rate as `numeric(24,12)`
 * and hands it back padded to its scale, so without normalising before the
 * hash is taken, every entry with a foreign-currency line would fail chain
 * verification the moment it was read back.
 */
export function normaliseDecimal(value: string): string {
  if (!value.includes('.')) return String(BigInt(value))

  const [whole = '0', fraction = ''] = value.split('.')
  const trimmed = fraction.replace(/0+$/, '')
  const normalisedWhole = String(BigInt(whole))
  return trimmed === '' ? normalisedWhole : `${normalisedWhole}.${trimmed}`
}

/**
 * Balance per currency (spec 6.2), with one qualification the spec does not
 * make explicit but which the arithmetic forces.
 *
 * Requiring every currency to balance independently sounds right and makes the
 * commonest foreign-currency entry impossible: paying a USD 100 supplier
 * invoice from a EUR bank account debits USD 100 and credits EUR 92, and the
 * USD side has nothing to balance against. So:
 *
 * - **Single-currency entry**: it must balance in that currency. This is what
 *   catches a typo or a wrong rate, and it covers the overwhelming majority of
 *   entries.
 * - **Cross-currency entry**: only the functional-currency total must balance.
 *   That is the authoritative invariant, and it is the one the reports and the
 *   balance sheet are built on.
 *
 * The functional check runs after conversion, in postJournalEntry, because it
 * needs the converted amounts. The database enforces the same split.
 */
export function balanceByCurrency(
  lines: readonly { currency: CurrencyCode; debit: bigint; credit: bigint }[],
): Map<CurrencyCode, bigint> {
  const totals = new Map<CurrencyCode, bigint>()
  for (const line of lines) {
    totals.set(line.currency, (totals.get(line.currency) ?? 0n) + line.debit - line.credit)
  }
  return totals
}

export function functionalBalance(lines: readonly PostedJournalLine[]): bigint {
  return lines.reduce((total, line) => total + line.functionalDebit - line.functionalCredit, 0n)
}

function validateDimensions(
  dimensions: readonly DimensionAssignment[],
  path: string,
): LedgerViolation[] {
  const seen = new Set<string>()
  const violations: LedgerViolation[] = []

  for (const dimension of dimensions) {
    if (seen.has(dimension.typeCode)) {
      violations.push(
        violation(
          'duplicate_dimension_type',
          `${path}.dimensions`,
          `Dimension ${dimension.typeCode} is assigned more than once on this line.`,
          { dimensionType: dimension.typeCode },
        ),
      )
    }
    seen.add(dimension.typeCode)
  }

  return violations
}

function validateLine(
  line: JournalLineInput,
  index: number,
  functionalCurrency: CurrencyCode,
): LedgerViolation[] {
  const path = `lines.${String(index)}`
  const violations: LedgerViolation[] = []

  if (line.debit < 0n || line.credit < 0n) {
    violations.push(
      violation(
        'line_negative_amount',
        path,
        'Amounts are unsigned. A negative debit is a credit, and must be posted as one.',
      ),
    )
  }

  if (line.debit > 0n && line.credit > 0n) {
    violations.push(
      violation('line_debit_and_credit', path, 'A line is either a debit or a credit, never both.'),
    )
  }

  if (line.debit === 0n && line.credit === 0n) {
    violations.push(violation('line_no_amount', path, 'A line with no amount posts nothing.'))
  }

  const currency = line.currency ?? functionalCurrency
  if (currency === functionalCurrency) {
    if (line.exchangeRate !== null) {
      violations.push(
        violation(
          'unexpected_exchange_rate',
          `${path}.exchangeRate`,
          `A line already in the functional currency (${functionalCurrency}) must not carry a rate.`,
        ),
      )
    }
  } else if (line.exchangeRate === null) {
    violations.push(
      violation(
        'missing_exchange_rate',
        `${path}.exchangeRate`,
        `A ${currency} line needs a rate to ${functionalCurrency}, and a source for it.`,
        { currency, functionalCurrency },
      ),
    )
  } else if (!isValidExchangeRate(line.exchangeRate)) {
    violations.push(
      violation(
        'invalid_exchange_rate',
        `${path}.exchangeRate`,
        'An exchange rate is a positive decimal string.',
        { value: line.exchangeRate },
      ),
    )
  }

  violations.push(...validateDimensions(line.dimensions, path))

  return violations
}

/**
 * Everything checkable without touching the database. The repository-backed
 * checks — account exists, period is open, dimension value is real — happen in
 * postJournalEntry once the context is loaded.
 */
export function validateCommandShape(
  command: PostJournalEntryCommand,
  functionalCurrency: CurrencyCode,
): LedgerViolation[] {
  const violations: LedgerViolation[] = []

  if (!isValidDate(command.bookingDate)) {
    violations.push(
      violation(
        'invalid_date',
        'bookingDate',
        'Booking date must be a real calendar date, YYYY-MM-DD.',
      ),
    )
  }
  if (!isValidDate(command.documentDate)) {
    violations.push(
      violation(
        'invalid_date',
        'documentDate',
        'Document date must be a real calendar date, YYYY-MM-DD.',
      ),
    )
  }

  if (command.lines.length < 2) {
    violations.push(
      violation(
        'entry_too_few_lines',
        'lines',
        'An entry has at least two lines. One line cannot balance.',
      ),
    )
  }

  command.lines.forEach((line, index) => {
    violations.push(...validateLine(line, index, functionalCurrency))
  })

  // Only worth reporting once the lines themselves make sense; an unbalanced
  // total is noise next to "line 3 has no amount".
  if (violations.length === 0) {
    const totals = balanceByCurrency(
      command.lines.map((line) => ({
        currency: line.currency ?? functionalCurrency,
        debit: line.debit,
        credit: line.credit,
      })),
    )

    if (totals.size === 1) {
      for (const [currency, difference] of totals) {
        if (difference !== 0n) {
          violations.push(
            violation(
              'entry_unbalanced',
              'lines',
              `Entry does not balance in ${currency}: debits minus credits is ${difference.toString()} minor units.`,
              { currency, difference: difference.toString() },
            ),
          )
        }
      }
    }
  }

  return violations
}
