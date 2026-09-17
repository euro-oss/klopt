/**
 * What a check found, in one place (ADR 0047).
 *
 * The same shape as `VIOLATION_MESSAGES`, and for the same reason. A finding
 * is not a refusal — it is a purchase invoice whose lines do not add up, a VAT
 * return whose control account moved untagged, a payment run with a supplier
 * who has no IBAN — but it is a sentence shown to somebody, and it was English
 * in a product whose default language is Dutch.
 *
 * The keys are `<area>.<code>`, with a suffix where one code says more than one
 * thing: a payer and a payee both have an IBAN that can be wrong, and telling
 * somebody which is the useful part of the message.
 *
 * Findings travel further than violations. They appear on a screen, they are
 * forwarded into a `LedgerViolation` when a check blocks a posting, and they go
 * out on the wire with their code. `messageKey` and `detail` ride along, so
 * whoever ends up rendering one can write it in their own language.
 */
export const FINDING_MESSAGES = {
  'icp.counterparty_without_vat_number':
    'An intra-community supply is zero-rated to a customer with no VAT number on file. The customer’s number is a condition of the zero rate, not a detail.',
  'icp.icp_mismatch':
    'The opgaaf totals {total} and rubriek 3b declares {rubriek3b} (minor units). The two describe the same supplies and must agree; the findings above name the lines the opgaaf could not place.',
  'icp.proof_predates_period':
    'The VIES check for this customer predates the period being declared. A number can be deregistered between one quarter and the next, so the proof is weaker than a check made during the period.',
  'icp.supply_without_counterparty':
    'An intra-community supply is posted with no customer on the line, so it cannot appear in the opgaaf. The aangifte declares it in 3b and the opgaaf cannot, which is the mismatch the Belastingdienst checks for first.',
  'icp.vat_number_invalid':
    'VIES says this VAT number is not valid. The zero rate does not apply, and the supply has to be corrected before either filing goes out.',
  'icp.vat_number_malformed':
    'A customer’s VAT number is not the shape that member state issues. VIES will refuse it, so it is refused here where it can still be corrected.',
  'icp.vat_number_not_eu':
    'A supply is declared as intra-community to a customer whose VAT number is not from an EU member state. Either the number or the tax code is wrong.',
  'icp.vat_number_unproven':
    'This VAT number has never been checked against VIES, or the last attempt could not reach it. What VIES said and when is the evidence for applying the zero rate; without it there is nothing to show.',
  'inbound.credit_note':
    'This is a credit note. It reduces what is owed, and its amounts are booked the other way round.',
  'inbound.currency_not_functional':
    'The document is in {currency} and the books are in {functionalCurrency}. The amounts are recorded as stated; the conversion is not done here.',
  'inbound.no_due_date':
    'The document carries no due date (BT-9). The supplier’s payment terms have been used instead.',
  'inbound.no_invoice_number':
    'The document carries no invoice number (BT-1), so there is nothing to book it under or to recognise it by if it arrives again.',
  'inbound.no_supplier_identifier':
    'The document identifies its sender by name only — no VAT number, no KvK number, no Peppol address — so it cannot be matched to a supplier automatically.',
  'inbound.no_tax_category':
    'Line {lineNumber} says nothing about its VAT category, so no tax code could be suggested.',
  'inbound.totals_disagree_with_lines':
    "The document's own total excluding VAT is {declared} and its lines add up to {fromLines}. Both are recorded as they are; the difference is usually a document-level charge or allowance, which is not read here.",
  'inbound.unmapped_tax_category':
    'Line {lineNumber} is category {categoryCode} at {percent}%, and no input tax code matches it. Code it by hand.',
  'payment.duplicate_end_to_end_id':
    '{endToEndId} appears twice. A bank may treat that as a duplicate payment.',
  'payment.empty_batch': 'A payment batch with no instructions pays nobody.',
  'payment.invalid_amount': 'A payment of zero or less is not a payment.',
  'payment.invalid_bic.creditor': '{creditorBic} is not a valid BIC.',
  'payment.invalid_bic.debtor': '{debtorBic} is not a valid BIC.',
  'payment.invalid_characters': 'SEPA does not accept {characters}.',
  'payment.invalid_currency':
    'A SEPA credit transfer is in euro. Use a different instrument for other currencies.',
  'payment.invalid_date': 'The execution date is yyyy-mm-dd.',
  'payment.invalid_iban.creditor': '{creditorIban} is not a valid IBAN.',
  'payment.invalid_iban.debtor': '{debtorIban} is not a valid IBAN.',
  'payment.missing_name.payee': 'A payee needs a name.',
  'payment.missing_name.payer': 'The payer needs a name.',
  'paymentRun.credit_exceeds_invoices':
    '{contactName} has {net} more credited than invoiced. That is a refund to ask them for, not a payment to send.',
  'paymentRun.invalid_iban':
    "{contactName}'s IBAN does not pass its own check digits. A mistyped IBAN gets the whole batch refused.",
  'paymentRun.mixed_currencies':
    "{contactName} has {count} open document(s) in another currency than the batch's {currency}. A pain.001 batch carries one currency; put those in their own run.",
  'paymentRun.no_iban':
    '{contactName} is owed {net} and has no IBAN on file. Add it under Relaties.',
  'paymentRun.nothing_owed':
    "{contactName}'s open invoices and credit notes cancel out exactly. Nothing to pay, and nothing wrong.",
  'purchase.duplicate_invoice_number':
    'This supplier has already sent invoice {supplierInvoiceNumber}. Booking it twice is how an invoice gets paid twice.',
  'purchase.lines_do_not_sum_to_net':
    'The lines add up to {lineNet} and the invoice states {netMinorUnits}. A line is missing or mistyped — what is in the system is not the document.',
  'purchase.lines_do_not_sum_to_tax':
    "The lines' VAT adds up to {lineTax} and the invoice states {taxMinorUnits}.",
  'purchase.net_plus_tax_is_not_total':
    '{netMinorUnits} plus {taxMinorUnits} is not {totalMinorUnits}. Check the figures against the document.',
  'purchase.no_rule_in_force': 'Tax code {taxCode} has no rule valid on {invoiceDate}.',
  'purchase.unknown_tax_code.no_such_code': 'There is no tax code {taxCode}.',
  'purchase.not_deductible':
    '{taxCode} is not deductible, so the {taxMinorUnits} of VAT on line {lineNumber} becomes part of the cost rather than voorbelasting.',
  'purchase.pro_rata':
    "{taxCode} is {share}% deductible, so {deductible} of line {lineNumber}'s VAT goes to voorbelasting and {deductible} to the cost.",
  'purchase.rate_mismatch':
    'Line {lineNumber} charges {taxMinorUnits} where {taxCode} at {rate}% over {netMinorUnits} would be {expected}. The invoice is booked as stated; check whether the code is right.',
  'purchase.reverse_charge_with_tax':
    'Line {lineNumber} uses {taxCode}, which means the VAT is ours to declare — but the invoice charges {taxMinorUnits} of it. Either the supplier should not have charged VAT, or this is the wrong code.',
  'purchase.unknown_tax_code':
    'Tax code {taxCode} is an output code. A purchase invoice needs an input code — the VAT on it is ours to deduct, not to charge.',
  'vat.code_declares_no_base':
    'A taxable base is posted under a code the aangifte gives no base box and that does not declare VAT either. Nothing about those lines reaches the return.',
  'vat.code_declares_no_vat':
    'VAT is posted under a zero-rate code, which has no rubriek to declare it in. Either the rate or the posting is wrong.',
  'vat.control_account_difference':
    'Account {accountNumber} {accountName} moved {taggedMovementMinorUnits} on tax-coded lines but the return declares {declaredMinorUnits} (minor units). The difference is the VAT that did not reach a rubriek — the findings above name every line of it.',
  'vat.no_rule_in_force':
    'A tax code exists but has no rule valid on the booking date, so those lines cannot be assigned to a rubriek. Extend the code’s validity window or reclassify the entries.',
  'vat.rate_mismatch':
    'Rubriek {id} declares VAT that its own base and rate do not produce. Expected roughly {expected}, found {vatMinorUnits} (minor units). A manual correction explains this; a miscoded line also does.',
  'vat.unknown_tax_code':
    'Journal lines carry a tax code that no configured code matches, so their VAT is in the books but not in the return.',
  'vat.untagged_control_movement':
    'A VAT control account moved without a tax code. A payment to or refund from the Belastingdienst looks exactly like this, and so does VAT booked by hand.',
  'xaf.accounts_without_rgs': '{unmapped} of {total} accounts have no RGS lead code: {accounts}',
  'xaf.date_outside_fiscal_year': '{trDt} is outside the fiscal year in the header.',
  'xaf.duplicate_account': 'Duplicate account {accID}.',
  'xaf.duplicate_journal': 'Duplicate journal {jrnID}.',
  'xaf.duplicate_transaction': 'Duplicate transaction number {nr} in this journal.',
  'xaf.field_too_long': "Exceeds the schema's {limit} character limit ({count}).",
  'xaf.file_unbalanced':
    'The file does not balance: {totalDebit} debit against {totalCredit} credit.',
  'xaf.invalid_country': 'Must be a two-letter ISO 3166 code.',
  'xaf.invalid_currency': '"{curCode}" is not an ISO 4217 code.',
  'xaf.invalid_date': '"{value}" is not an ISO date.',
  'xaf.negative_amount': 'XAF amounts are unsigned.',
  'xaf.opening_balance_unbalanced':
    'Does not balance: {openingDebit} debit against {openingCredit} credit.',
  'xaf.period_reversed': 'endDate is before startDate.',
  'xaf.transaction_unbalanced':
    'Does not balance: {transactionDebit} debit against {transactionCredit} credit, in minor units.',
  'xaf.transaction_without_lines': 'A transaction with no lines.',
  'xaf.unknown_account': 'References unknown account {accountId}.',
  'xaf.unknown_offset_account': 'Unknown account {offsetAccID}.',
  'xaf.unknown_party': 'References unknown party {custSupID}.',
  'xaf.unknown_period': 'Period {periodNumber} is not declared.',
  'xaf.unknown_vat_code': 'References unknown VAT code {vatID}.',
} as const satisfies Readonly<Record<string, string>>

export type FindingMessageKey = keyof typeof FINDING_MESSAGES

/** Substitutes `{name}` from `detail`, leaving unknown placeholders visible. */
export function renderFindingMessage(
  key: FindingMessageKey,
  detail?: Readonly<Record<string, string>>,
): string {
  const text: string = FINDING_MESSAGES[key]
  if (detail === undefined) return text
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) =>
    Object.hasOwn(detail, name) ? (detail[name] ?? whole) : whole,
  )
}
