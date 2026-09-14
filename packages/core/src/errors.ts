/**
 * Deterministic errors (spec 10.2). Stable machine-readable code, the field at
 * fault, and the rule that was violated. "400 Bad Request" is not an API.
 *
 * Codes are part of the public contract: an integrator branches on them. Add
 * new ones freely, never repurpose an existing one.
 */
import type { LedgerErrorCode } from './error-codes.js'
import {
  VIOLATION_MESSAGES,
  renderViolationMessage,
  type ViolationMessageKey,
} from './violation-messages.js'

export type { LedgerErrorCode } from './error-codes.js'

export interface LedgerViolation {
  readonly code: LedgerErrorCode
  /** Dotted path into the command, e.g. `lines.2.accountNumber`. Null if entry-wide. */
  readonly path: string | null
  readonly message: string
  /**
   * Which sentence this is, for a client that wants to write its own.
   *
   * The `code` is coarse on purpose — `invalid_tax_code` covers sixteen
   * different faults — so it cannot double as a translation key without
   * flattening sixteen useful messages into one vague one. This names the
   * sentence; `message` is that sentence rendered in English, and `detail`
   * carries the values in it.
   *
   * `null` where the sentence came from somewhere that already had one: a
   * payment finding, a UBL problem. Those carry their own code in `detail`.
   */
  readonly messageKey: ViolationMessageKey | null
  readonly detail?: Readonly<Record<string, string>>
}

/**
 * Carries every violation found, not just the first. An importer posting a
 * thousand entries should learn everything wrong with one of them in a single
 * round trip.
 */
export class LedgerError extends Error {
  readonly violations: readonly LedgerViolation[]

  constructor(violations: readonly LedgerViolation[]) {
    const [first] = violations
    super(first ? `${first.code}: ${first.message}` : 'Ledger validation failed')
    this.name = 'LedgerError'
    this.violations = violations
  }

  get code(): LedgerErrorCode | null {
    return this.violations[0]?.code ?? null
  }
}

/**
 * A violation, named by which sentence it is.
 *
 * The message is not passed in: it comes from `VIOLATION_MESSAGES`, rendered
 * with `detail`. One place holds every sentence the domain can say, which is
 * what makes translating them possible at all — and what makes a key that is
 * not in the catalogue a compile error rather than a screen showing a key.
 */
export function violation(
  key: ViolationMessageKey,
  path: string | null,
  detail?: Readonly<Record<string, string>>,
): LedgerViolation {
  const entry = VIOLATION_MESSAGES[key]
  const message = renderViolationMessage(entry.text, detail)
  return detail === undefined
    ? { code: entry.code, path, message, messageKey: key }
    : { code: entry.code, path, message, messageKey: key, detail }
}

/**
 * A violation whose sentence was written somewhere else.
 *
 * Eight call sites turn a finding — a payment problem, a UBL fault, a VAT
 * reconciliation warning — into a violation, and the finding already carries
 * its own message and its own code. Copying those sentences into the
 * catalogue would make two places to change one of them.
 *
 * `messageKey` is null, and `detail.code` is the finding's code, which is what
 * a client translates from instead. Named rather than an overload of
 * `violation`, so that the exception is visible at every site that takes it.
 */
export function forwarded(
  code: LedgerErrorCode,
  path: string | null,
  message: string,
  detail?: Readonly<Record<string, string>>,
): LedgerViolation {
  return detail === undefined
    ? { code, path, message, messageKey: null }
    : { code, path, message, messageKey: null, detail }
}
