import { violation, LedgerError } from '../errors.js'
import { formatMinorUnits } from '../format/index.js'
import type { TaxCodeRule } from '../vat/tax-code.js'

/**
 * Verifying a supplier's invoice rather than recomputing it.
 *
 * The distinction this module exists for: our arithmetic disagreeing with the
 * supplier's does not make their document wrong. The invoice states what we owe
 * and what we may deduct, and if their total is a cent off ours, their total is
 * still what has to be paid and what the VAT return has to reflect. Silently
 * replacing their figure with ours would mean the books say something the
 * document does not — and the document is what an inspector reads.
 *
 * So nothing here changes an amount. It classifies:
 *
 *  - **Blocking**: the capture is wrong. The lines do not sum to the stated
 *    net, or net plus VAT is not the stated total. Either somebody mistyped or
 *    a line is missing, and in both cases what is in the system is not the
 *    document in the envelope.
 *  - **Warning**: the capture is faithful and something about it is worth a
 *    look. The commonest by far is a rate that does not match: suppliers round
 *    per line where we round per invoice, and a single line can cover two
 *    rates. A warning that fired on every one of those would be ignored within
 *    a week, which is why the tolerance is per line rather than absolute.
 */

export interface PurchaseLineInput {
  readonly description: string
  /** The account the cost lands on. */
  readonly accountNumber: string
  /** Our tax code, not the supplier's. What we may deduct is our question. */
  readonly taxCode: string
  /** The base, as the supplier states it. */
  readonly netMinorUnits: bigint
  /** The VAT the supplier charged on this line. Zero under a reverse charge. */
  readonly taxMinorUnits: bigint
}

export interface PurchaseInvoiceInput {
  /** The supplier's own number, preserved exactly (spec 14: open items). */
  readonly supplierInvoiceNumber: string
  readonly kind: 'invoice' | 'credit_note'
  readonly invoiceDate: string
  readonly dueDate: string
  readonly currency: string
  /** The totals as stated on the document. Never derived. */
  readonly netMinorUnits: bigint
  readonly taxMinorUnits: bigint
  readonly totalMinorUnits: bigint
  readonly lines: readonly PurchaseLineInput[]
}

export type PurchaseFindingCode =
  | 'lines_do_not_sum_to_net'
  | 'lines_do_not_sum_to_tax'
  | 'net_plus_tax_is_not_total'
  | 'rate_mismatch'
  | 'reverse_charge_with_tax'
  | 'unknown_tax_code'
  | 'no_rule_in_force'
  | 'not_deductible'
  | 'pro_rata'
  | 'duplicate_invoice_number'

export interface PurchaseFinding {
  readonly code: PurchaseFindingCode
  readonly severity: 'blocking' | 'warning' | 'note'
  readonly message: string
  /** Which line, when it is about one. */
  readonly lineNumber: number | null
  readonly amountMinorUnits: bigint
}

export interface PurchaseCheckRequest {
  readonly invoice: PurchaseInvoiceInput
  readonly rules: readonly TaxCodeRule[]
  /**
   * True when this supplier has already sent an invoice with this number.
   *
   * Paying the same invoice twice is the classic accounts-payable failure, and
   * a supplier's own numbering is the only thing that identifies a document
   * across two arrivals of it — by email and then by post, or by Peppol and
   * then as a PDF chase.
   */
  readonly isDuplicate: boolean
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

function money(minorUnits: bigint): string {
  return formatMinorUnits(minorUnits)
}

/** Whether this code means we self-assess the VAT rather than being charged it. */
export function selfAssesses(rule: TaxCodeRule): boolean {
  return (
    rule.reverseCharge !== 'none' ||
    rule.scope === 'intra_community_acquisition' ||
    rule.scope === 'import'
  )
}

export function checkPurchaseInvoice(request: PurchaseCheckRequest): readonly PurchaseFinding[] {
  const findings: PurchaseFinding[] = []
  const { invoice } = request

  const add = (
    code: PurchaseFindingCode,
    severity: 'blocking' | 'warning' | 'note',
    message: string,
    options: { lineNumber?: number; amountMinorUnits?: bigint } = {},
  ): void => {
    findings.push({
      code,
      severity,
      message,
      lineNumber: options.lineNumber ?? null,
      amountMinorUnits: options.amountMinorUnits ?? 0n,
    })
  }

  if (request.isDuplicate) {
    add(
      'duplicate_invoice_number',
      'blocking',
      `This supplier has already sent invoice ${invoice.supplierInvoiceNumber}. Booking it twice is how an invoice gets paid twice.`,
    )
  }

  const lineNet = invoice.lines.reduce((sum, line) => sum + line.netMinorUnits, 0n)
  const lineTax = invoice.lines.reduce((sum, line) => sum + line.taxMinorUnits, 0n)

  if (lineNet !== invoice.netMinorUnits) {
    add(
      'lines_do_not_sum_to_net',
      'blocking',
      `The lines add up to ${money(lineNet)} and the invoice states ${money(invoice.netMinorUnits)}. A line is missing or mistyped — what is in the system is not the document.`,
      { amountMinorUnits: lineNet - invoice.netMinorUnits },
    )
  }

  if (lineTax !== invoice.taxMinorUnits) {
    add(
      'lines_do_not_sum_to_tax',
      'blocking',
      `The lines' VAT adds up to ${money(lineTax)} and the invoice states ${money(invoice.taxMinorUnits)}.`,
      { amountMinorUnits: lineTax - invoice.taxMinorUnits },
    )
  }

  if (invoice.netMinorUnits + invoice.taxMinorUnits !== invoice.totalMinorUnits) {
    add(
      'net_plus_tax_is_not_total',
      'blocking',
      `${money(invoice.netMinorUnits)} plus ${money(invoice.taxMinorUnits)} is not ${money(invoice.totalMinorUnits)}. Check the figures against the document.`,
      {
        amountMinorUnits: invoice.netMinorUnits + invoice.taxMinorUnits - invoice.totalMinorUnits,
      },
    )
  }

  invoice.lines.forEach((line, index) => {
    const lineNumber = index + 1
    const rule = request.rules.find(
      (entry) =>
        entry.code === line.taxCode &&
        entry.validFrom <= invoice.invoiceDate &&
        (entry.validTo === null || entry.validTo >= invoice.invoiceDate),
    )

    if (rule === undefined) {
      const known = request.rules.some((entry) => entry.code === line.taxCode)
      add(
        known ? 'no_rule_in_force' : 'unknown_tax_code',
        'blocking',
        known
          ? `Tax code ${line.taxCode} has no rule valid on ${invoice.invoiceDate}.`
          : `There is no tax code ${line.taxCode}.`,
        { lineNumber },
      )
      return
    }

    if (rule.direction !== 'input') {
      add(
        'unknown_tax_code',
        'blocking',
        `Tax code ${line.taxCode} is an output code. A purchase invoice needs an input code — the VAT on it is ours to deduct, not to charge.`,
        { lineNumber },
      )
      return
    }

    if (selfAssesses(rule)) {
      // The supplier charged nothing and we owe it ourselves. Their line
      // carrying VAT means either the code or the document is wrong, and both
      // are worth stopping for: booking it would declare the VAT twice.
      if (line.taxMinorUnits !== 0n) {
        add(
          'reverse_charge_with_tax',
          'blocking',
          `Line ${String(lineNumber)} uses ${line.taxCode}, which means the VAT is ours to declare — but the invoice charges ${money(line.taxMinorUnits)} of it. Either the supplier should not have charged VAT, or this is the wrong code.`,
          { lineNumber, amountMinorUnits: line.taxMinorUnits },
        )
      }
      return
    }

    const expected = (line.netMinorUnits * BigInt(rule.rateBasisPoints)) / 10_000n
    // One cent of slack. A supplier rounding per line and us rounding per
    // invoice differ by exactly that, and a warning that fires on every
    // ordinary invoice is a warning nobody reads.
    if (abs(line.taxMinorUnits - expected) > 1n) {
      add(
        'rate_mismatch',
        'warning',
        `Line ${String(lineNumber)} charges ${money(line.taxMinorUnits)} where ${line.taxCode} at ${(rule.rateBasisPoints / 100).toFixed(2)}% over ${money(line.netMinorUnits)} would be ${money(expected)}. The invoice is booked as stated; check whether the code is right.`,
        { lineNumber, amountMinorUnits: line.taxMinorUnits - expected },
      )
    }

    // Not problems — consequences. Said out loud because the number that
    // reaches rubriek 5b is smaller than the VAT on the document, and somebody
    // reconciling the two should not have to work out why.
    if (rule.deductibility === 'none') {
      add(
        'not_deductible',
        'note',
        `${line.taxCode} is not deductible, so the ${money(line.taxMinorUnits)} of VAT on line ${String(lineNumber)} becomes part of the cost rather than voorbelasting.`,
        { lineNumber, amountMinorUnits: line.taxMinorUnits },
      )
    }
    if (rule.deductibility === 'pro_rata') {
      const share = rule.proRataBasisPoints ?? 0
      const deductible = (line.taxMinorUnits * BigInt(share)) / 10_000n
      add(
        'pro_rata',
        'note',
        `${line.taxCode} is ${(share / 100).toFixed(2)}% deductible, so ${money(deductible)} of line ${String(lineNumber)}'s VAT goes to voorbelasting and ${money(line.taxMinorUnits - deductible)} to the cost.`,
        { lineNumber, amountMinorUnits: deductible },
      )
    }
  })

  const order = { blocking: 0, warning: 1, note: 2 } as const
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || (a.lineNumber ?? 0) - (b.lineNumber ?? 0),
  )

  return findings
}

/** Whether the capture is faithful enough to put in the books. */
export function isBookable(findings: readonly PurchaseFinding[]): boolean {
  return !findings.some((finding) => finding.severity === 'blocking')
}

export function assertBookable(findings: readonly PurchaseFinding[]): void {
  const blocking = findings.filter((finding) => finding.severity === 'blocking')
  if (blocking.length === 0) return

  throw new LedgerError(
    blocking.map((finding) =>
      violation(
        'invoice_not_bookable',
        finding.lineNumber === null ? 'invoice' : `lines.${String(finding.lineNumber - 1)}`,
        finding.message,
        { code: finding.code, amount: finding.amountMinorUnits.toString() },
      ),
    ),
  )
}
