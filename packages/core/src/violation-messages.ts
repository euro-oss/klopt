import type { LedgerErrorCode } from './error-codes.js'

/**
 * Every sentence the domain can refuse a command with, in one place.
 *
 * ## Why the code is not the key
 *
 * A `LedgerErrorCode` is what an integrator branches on, and it is
 * deliberately coarse: `invalid_tax_code` covers sixteen different things a
 * tax code can be wrong about, and `invalid_date` covers ten. Translating on
 * the code would replace those sixteen specific sentences with one vague one,
 * which is a worse screen for the sake of a better mechanism.
 *
 * So the sentence has an identity of its own. `code` stays the contract;
 * `key` is which sentence, and it is what `apps/web` translates from.
 *
 * ## English here, Dutch in the UI
 *
 * The other way round from ADR 0038, and on purpose. This is the API's
 * language — the field names, the error codes and the operation summaries are
 * all English, and an integrator reading a problem document gets a language
 * they can act on. The domain has no locale; the *reader* does, and the reader
 * is the UI's problem.
 *
 * ## Placeholders
 *
 * `{name}` is filled from the violation's `detail`, which is the same record
 * that goes out on the wire. That is the point: a client with a message
 * catalogue has everything it needs to write the sentence itself, and one
 * without it gets ours already rendered.
 *
 * A placeholder with no value is left visible. An obvious `{accountNumber}`
 * on screen is a bug somebody reports; a blank is one nobody notices.
 */
export interface ViolationMessage {
  readonly code: LedgerErrorCode
  readonly text: string
}

export const VIOLATION_MESSAGES = {
  account_blocked: {
    code: 'account_blocked',
    text: 'Account {accountNumber} ({name}) is blocked for posting.',
  },
  approval_by_script: {
    code: 'approval_by_script',
    text: 'An approval has to be somebody looking. A script cannot authorise a cost, though a human working through the API with a token can.',
  },
  'approval_by_submitter.not_a_script': {
    code: 'approval_by_submitter',
    text: 'A payment batch has to be approved by a person. A script cannot be the second pair of eyes.',
  },
  'approval_by_submitter.not_the_submitter': {
    code: 'approval_by_submitter',
    text: 'A payment batch has to be approved by somebody other than the person who submitted it.',
  },
  unknown_invitation: {
    code: 'unknown_invitation',
    text: 'There is no such open invitation.',
  },
  'unknown_member.not_a_member': {
    code: 'unknown_member',
    text: 'That person is not a member of this administration.',
  },
  'unknown_member.say_who': {
    code: 'unknown_member',
    text: 'Say who is being removed.',
  },
  dimension_value_blocked: {
    code: 'dimension_value_blocked',
    text: 'Dimension value {dimensionType}/{dimensionValue} is blocked.',
  },
  duplicate_dimension_type: {
    code: 'duplicate_dimension_type',
    text: 'Dimension {dimensionType} is assigned more than once on this line.',
  },
  'entry_too_few_lines.entry_least_two': {
    code: 'entry_too_few_lines',
    text: 'An entry has at least two lines. One line cannot balance.',
  },
  'entry_too_few_lines.invoice_line': {
    code: 'entry_too_few_lines',
    text: 'An invoice needs a line.',
  },
  'entry_unbalanced.allocations_exceed_line': {
    code: 'entry_unbalanced',
    text: 'The allocations come to {allocated}, which is more than the {available} this line accounts for.',
  },
  'entry_unbalanced.does_not_balance': {
    code: 'entry_unbalanced',
    text: 'Entry does not balance in {currency}: debits minus credits is {difference} minor units.',
  },
  'entry_unbalanced.file_control_totals': {
    code: 'entry_unbalanced',
    text: "The file's own control totals do not match its contents: it declares {declaredLines} lines, {declaredDebit} debit and {declaredCredit} credit; it contains {lineCount}, {totalDebit} and {totalCredit}.",
  },
  entry_unbalanced_functional: {
    code: 'entry_unbalanced_functional',
    text: 'Entry does not balance in {functionalCurrency}: debits minus credits is {difference} minor units. If this is a realised exchange result, post the remainder to an exchange-difference account.',
  },
  idempotency_key_reused: {
    code: 'idempotency_key_reused',
    text: 'This idempotency key was used for a different request. Keys are per request, not per client.',
  },
  invalid_currency: { code: 'invalid_currency', text: 'Use a three-letter ISO 4217 code.' },
  'invalid_date.booking_date_calendar': {
    code: 'invalid_date',
    text: 'Booking date must be a real calendar date, YYYY-MM-DD.',
  },
  'invalid_date.date': { code: 'invalid_date', text: '{date} is not a date.' },
  'invalid_date.date_yyyy_mm': { code: 'invalid_date', text: 'A date is yyyy-mm-dd.' },
  'invalid_date.declaration_year_four': {
    code: 'invalid_date',
    text: 'A declaration year is four digits.',
  },
  'invalid_date.document_date_calendar': {
    code: 'invalid_date',
    text: 'Document date must be a real calendar date, YYYY-MM-DD.',
  },
  'invalid_date.fiscal_year_labelled': {
    code: 'invalid_date',
    text: 'A fiscal year is labelled by its four-digit start year.',
  },
  'invalid_date.starting_month': { code: 'invalid_date', text: 'The starting month is 1 to 12.' },
  'invalid_date.validfrom_date': { code: 'invalid_date', text: 'validFrom must be a date.' },
  'invalid_date.validity_window_end': {
    code: 'invalid_date',
    text: 'A validity window cannot end before it starts.',
  },
  'invalid_date.validto_date_null': {
    code: 'invalid_date',
    text: 'validTo must be a date or null.',
  },
  'invalid_document.document_invoice_lines': {
    code: 'invalid_document',
    text: 'The document has no invoice lines.',
  },
  'invalid_document.expected_ubl_invoice': {
    code: 'invalid_document',
    text: 'Expected a UBL Invoice or CreditNote, found <{name}>.',
  },
  'invalid_document.readable_xml': {
    code: 'invalid_document',
    text: 'This is not readable XML: {error}',
  },
  invalid_email: { code: 'invalid_email', text: 'That is not an email address.' },
  'invalid_exchange_rate.decimal_number': {
    code: 'invalid_exchange_rate',
    text: '"{value}" is not a decimal number.',
  },
  'invalid_exchange_rate.exchange_rate_positive': {
    code: 'invalid_exchange_rate',
    text: 'An exchange rate is a positive decimal string.',
  },
  invalid_kvk_number: { code: 'invalid_kvk_number', text: 'A KvK number is eight digits.' },
  'invalid_name.administration_name': {
    code: 'invalid_name',
    text: 'An administration needs a name.',
  },
  'invalid_name.filing_legal_name': {
    code: 'invalid_name',
    text: 'The filing needs the entity’s legal name.',
  },
  'invalid_name.name_most_characters': {
    code: 'invalid_name',
    text: 'A name is at most 200 characters.',
  },
  'invalid_tax_code.aangifte_base_box': {
    code: 'invalid_tax_code',
    text: 'The aangifte has no base box for this kind of transaction — rubriek 5b reports VAT only. Leave it empty.',
  },
  'invalid_tax_code.article_deferment_applies': {
    code: 'invalid_tax_code',
    text: 'Article 23 deferment applies to imports. Set the scope to import.',
  },
  'invalid_tax_code.base_box_named': {
    code: 'invalid_tax_code',
    text: 'This transaction has a base box on the aangifte, so the code must name it.',
  },
  'invalid_tax_code.deductibility_describes_input': {
    code: 'invalid_tax_code',
    text: 'Deductibility describes input VAT. An output code has none.',
  },
  'invalid_tax_code.pro_rata_code': {
    code: 'invalid_tax_code',
    text: 'A pro rata code needs a recoverable share strictly between 0 and 10000 basis points. Use full or none for the ends.',
  },
  'invalid_tax_code.rate_basis_points': {
    code: 'invalid_tax_code',
    text: 'A rate is 0 to 10000 basis points.',
  },
  'invalid_tax_code.rate_needs_rubriek': {
    code: 'invalid_tax_code',
    text: 'A code with a rate above zero produces VAT, so it needs a rubriek to declare it in.',
  },
  'invalid_tax_code.recoverable_share_only': {
    code: 'invalid_tax_code',
    text: 'A recoverable share only means something on a pro rata code.',
  },
  'invalid_tax_code.rubriek_reports_base': {
    code: 'invalid_tax_code',
    text: 'Rubriek {id} reports no base amount.',
  },
  'invalid_tax_code.rubriek_reports_vat': {
    code: 'invalid_tax_code',
    text: 'Rubriek {id} reports no VAT amount.',
  },
  'invalid_tax_code.scope_declares_base': {
    code: 'invalid_tax_code',
    text: 'Scope {scope} declares its base in {allowed}, not {baseRubriek}.',
  },
  'invalid_tax_code.self_assesses_vat': {
    code: 'invalid_tax_code',
    text: '{taxCode} self-assesses its VAT but names no deduction code, so the voorbelasting side has nowhere to go. Set deductionCode on it.',
  },
  'invalid_tax_code.supply_kind_named': {
    code: 'invalid_tax_code',
    text: 'The ICP opgaaf reports goods and services separately, so an intra-community supply must say which it is.',
  },
  'invalid_tax_code.tax_code_code': { code: 'invalid_tax_code', text: 'A tax code needs a code.' },
  'invalid_tax_code.tax_code_rule': {
    code: 'invalid_tax_code',
    text: 'Tax code {taxCode} has no rule valid on {invoiceDate}. This should have been caught before posting.',
  },
  'invalid_tax_code.under_domestic_reverse': {
    code: 'invalid_tax_code',
    text: 'Under a domestic reverse charge the supplier charges no VAT. The rate on the outgoing code is zero.',
  },
  'invalid_tax_code.zero_rate_code': {
    code: 'invalid_tax_code',
    text: 'A zero-rate code produces no VAT. Leave its VAT rubriek empty.',
  },
  'invalid_vat_number.omzetbelastingnummer': {
    code: 'invalid_vat_number',
    text: 'The aangifte is identified by the omzetbelastingnummer, and {vatNumber} is not one. Fill it in under Instellingen.',
  },
  'invalid_vat_number.dutch_vat_number': {
    code: 'invalid_vat_number',
    text: 'A Dutch VAT number looks like NL123456789B01.',
  },
  'last_owner.make_somebody_owner': {
    code: 'last_owner',
    text: 'This is the last owner. Make somebody else an owner first.',
  },
  'last_owner.without_owner': {
    code: 'last_owner',
    text: 'This is the last owner. An administration cannot be left without one.',
  },
  line_debit_and_credit: {
    code: 'line_debit_and_credit',
    text: 'A line is either a debit or a credit, never both.',
  },
  'line_negative_amount.allocation_point_way': {
    code: 'line_negative_amount',
    text: 'The allocation to {invoiceNumber} does not point the same way as the payment.',
  },
  'line_negative_amount.amounts_unsigned': {
    code: 'line_negative_amount',
    text: 'Amounts are unsigned. A negative debit is a credit, and must be posted as one.',
  },
  'line_negative_amount.charges_negative': {
    code: 'line_negative_amount',
    text: 'Charges cannot be negative.',
  },
  'line_no_amount.bank_line_amount': {
    code: 'line_no_amount',
    text: 'A bank line with no amount cannot be matched.',
  },
  'line_no_amount.bank_line_zero': {
    code: 'line_no_amount',
    text: 'A bank line of zero posts nothing.',
  },
  'line_no_amount.invoice_totalling_zero': {
    code: 'line_no_amount',
    text: 'An invoice totalling zero posts nothing.',
  },
  'line_no_amount.line_amount_posts': {
    code: 'line_no_amount',
    text: 'A line with no amount posts nothing.',
  },
  missing_exchange_rate: {
    code: 'missing_exchange_rate',
    text: 'A {currency} line needs a rate to {functionalCurrency}, and a source for it.',
  },
  missing_required_dimension: {
    code: 'missing_required_dimension',
    text: 'Account {accountNumber} requires a {dimensionType} dimension.',
  },
  no_period_for_date: {
    code: 'no_period_for_date',
    text: 'No fiscal period contains {bookingDate}. Create the fiscal year first.',
  },
  period_already_filed: {
    code: 'period_already_filed',
    text: 'This period has been declared and the figures have not changed. There is nothing to correct, so there is no suppletie to file.',
  },
  period_hard_closed: {
    code: 'period_hard_closed',
    text: 'Period {fiscalYear}-{period} is closed. Post to an open period, or reopen it deliberately.',
  },
  period_soft_closed: {
    code: 'period_soft_closed',
    text: 'Period {fiscalYear}-{period} is soft-closed: only an accountant may post to it.',
  },
  reversal_target_already_reversed: {
    code: 'reversal_target_already_reversed',
    text: 'Entry {reversesEntryId} was already reversed by {reversedBy}.',
  },
  reversal_target_not_found: {
    code: 'reversal_target_not_found',
    text: 'No entry {reversesEntryId} to reverse.',
  },
  unexpected_exchange_rate: {
    code: 'unexpected_exchange_rate',
    text: 'A line already in the functional currency ({functionalCurrency}) must not carry a rate.',
  },
  'unknown_account.account': { code: 'unknown_account', text: 'No account {accountNumber}.' },
  'unknown_account.account_appropriate_result': {
    code: 'unknown_account',
    text: 'No account {accountNumber} to appropriate the result to.',
  },
  'unknown_account.account_year_s': {
    code: 'unknown_account',
    text: "Account {accountNumber} is {accountType}. The year's result is appropriated to equity.",
  },
  'unknown_account.accounted_say_account': {
    code: 'unknown_account',
    text: '{remainder} is not accounted for. Say which account it belongs to.',
  },
  'unknown_account.charges_account_post': {
    code: 'unknown_account',
    text: 'Charges need an account to post to.',
  },
  'unknown_account.tax_code': { code: 'unknown_account', text: 'No tax code {taxCode}.' },
  'unknown_account.tax_code_no_account': {
    code: 'unknown_account',
    text: 'Tax code {taxCode} has no ledger account. Set one before booking with it.',
  },
  'unknown_account.deduction_code_no_account': {
    code: 'unknown_account',
    text: 'Tax code {deductionCode} has no ledger account. Set one before booking with it.',
  },
  'unknown_account.tax_code_no_account_invoicing': {
    code: 'unknown_account',
    text: 'Tax code {taxCode} has no ledger account. Set one before invoicing with it.',
  },
  unknown_dimension_type: {
    code: 'unknown_dimension_type',
    text: 'No dimension type {dimensionType}.',
  },
  unknown_dimension_value: {
    code: 'unknown_dimension_value',
    text: 'No value {dimensionValue} for dimension {dimensionType}.',
  },
  unknown_entity: { code: 'unknown_entity', text: 'No entity {entityId}.' },
  unknown_entry: {
    code: 'unknown_entry',
    text: 'The entry recorded for this idempotency key no longer exists.',
  },
  unknown_journal: { code: 'unknown_journal', text: 'No journal {journalCode}.' },
  unknown_role: {
    code: 'unknown_role',
    text: 'Role must be owner, bookkeeper, accountant or auditor.',
  },
  'unknown_rubriek.rubriek_btw_aangifte': {
    code: 'unknown_rubriek',
    text: '{id} is not a rubriek on the BTW-aangifte.',
  },
  'unknown_rubriek.rubriek_computed_subtotal': {
    code: 'unknown_rubriek',
    text: 'Rubriek {id} is a computed subtotal. A tax code cannot write to it.',
  },
  unknown_tax_code: {
    code: 'unknown_tax_code',
    text: 'This file uses {count} tax code(s) this administration does not have: {codesWithNames}. Create them, mapped to their rubrieken, and try again — importing without them would post a year that declares no VAT.',
  },
  'unknown_taxonomy.mapping_maps_btw': {
    code: 'unknown_taxonomy',
    text: 'Mapping {version} maps {report}, not the BTW-aangifte.',
  },
  'unknown_taxonomy.rubriek_base_mapping': {
    code: 'unknown_taxonomy',
    text: 'Rubriek {id} has a base of {baseMinorUnits} and mapping {version} has no element for it.',
  },
  'unknown_taxonomy.rubriek_vat_mapping': {
    code: 'unknown_taxonomy',
    text: 'Rubriek {id} has VAT of {vatMinorUnits} and mapping {version} has no element for it.',
  },
  'unknown_taxonomy.taxonomy_mapping_covers': {
    code: 'unknown_taxonomy',
    text: 'No {report} taxonomy mapping covers {periodFrom}..{periodTo}. Loaded: {loaded}. A taxonomy is a data release — see docs/compliance-calendar.md.',
  },
  'unknown_taxonomy.taxonomy_mappings_claim': {
    code: 'unknown_taxonomy',
    text: '{count} taxonomy mappings claim {periodFrom}..{periodTo}: {versions}. Fix their validity windows.',
  },
  unknown_vat_period: {
    code: 'unknown_vat_period',
    text: '{code} is not a declaration period. Use 2026, 2026-Q1 or 2026-03.',
  },
  'vat_out_of_balance.accepting_warning_reason': {
    code: 'vat_out_of_balance',
    text: 'Accepting a warning needs a reason. It becomes part of the evidence for this period.',
  },
  'vat_out_of_balance.return_warning_s': {
    code: 'vat_out_of_balance',
    text: 'This return has {count} warning(s). Read them and accept them explicitly, with a reason, or fix them.',
  },
  wrong_batch_state: {
    code: 'wrong_batch_state',
    text: 'A {current} batch cannot be {actionPast}.',
  },
  wrong_invoice_state: {
    code: 'wrong_invoice_state',
    text: 'An invoice that is {current} cannot be {actionPast}. That is allowed from: {allowedFrom}.',
  },
} as const satisfies Readonly<Record<string, ViolationMessage>>

export type ViolationMessageKey = keyof typeof VIOLATION_MESSAGES

/** Substitutes `{name}` from `detail`, leaving unknown placeholders visible. */
export function renderViolationMessage(
  text: string,
  detail?: Readonly<Record<string, string>>,
): string {
  if (detail === undefined) return text
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) =>
    Object.hasOwn(detail, name) ? (detail[name] ?? whole) : whole,
  )
}
