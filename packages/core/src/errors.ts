/**
 * Deterministic errors (spec 10.2). Stable machine-readable code, the field at
 * fault, and the rule that was violated. "400 Bad Request" is not an API.
 *
 * Codes are part of the public contract: an integrator branches on them. Add
 * new ones freely, never repurpose an existing one.
 */
export type LedgerErrorCode =
  | 'entry_unbalanced'
  | 'entry_unbalanced_functional'
  | 'entry_too_few_lines'
  | 'line_debit_and_credit'
  | 'line_no_amount'
  | 'line_negative_amount'
  | 'unknown_account'
  | 'account_blocked'
  | 'unknown_journal'
  | 'unknown_dimension_type'
  | 'unknown_dimension_value'
  | 'dimension_value_blocked'
  | 'duplicate_dimension_type'
  | 'missing_required_dimension'
  | 'no_period_for_date'
  | 'period_hard_closed'
  | 'period_soft_closed'
  | 'invalid_date'
  | 'document_date_after_booking_date'
  | 'missing_exchange_rate'
  | 'unexpected_exchange_rate'
  | 'invalid_exchange_rate'
  | 'unknown_entity'
  | 'unknown_entry'
  | 'reversal_target_not_found'
  | 'reversal_target_already_reversed'
  | 'idempotency_key_reused'
  | 'invalid_name'
  | 'invalid_currency'
  | 'invalid_kvk_number'
  | 'invalid_vat_number'
  | 'unknown_chart'
  | 'duplicate_entity_name'
  | 'duplicate_fiscal_year'
  | 'invalid_email'
  | 'unknown_role'
  | 'unknown_member'
  | 'already_member'
  | 'last_owner'
  | 'unknown_invitation'
  | 'invitation_expired'
  | 'invalid_payment'
  | 'approval_by_submitter'
  | 'wrong_batch_state'
  | 'chain_broken'

export interface LedgerViolation {
  readonly code: LedgerErrorCode
  /** Dotted path into the command, e.g. `lines.2.accountNumber`. Null if entry-wide. */
  readonly path: string | null
  readonly message: string
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

export function violation(
  code: LedgerErrorCode,
  path: string | null,
  message: string,
  detail?: Readonly<Record<string, string>>,
): LedgerViolation {
  return detail === undefined ? { code, path, message } : { code, path, message, detail }
}
