import { violation, LedgerError, type LedgerViolation } from '../errors.js'
import { parseMinorUnits } from '../format/index.js'
import { at, child, childrenNamed, parseXmlDocument, textAt, textOf } from '../xml/parse.js'
import type { PurchaseInvoiceInput, PurchaseLineInput } from './check.js'

/**
 * Reading an inbound UBL invoice into a draft (spec 7.5).
 *
 * "Accept UBL, parse into a draft purchase invoice, attach the original XML,
 * and route into the approval queue."
 *
 * Three things shape this, and none of them is the XML.
 *
 * **It is a reader, not a validator.** An invoice that arrives is a document
 * somebody sent us in good faith, and refusing it because it fails a Peppol
 * rule leaves it nowhere — not in the inbox, not in the books, and not in front
 * of a human. So anything structurally readable becomes a draft, and what is
 * missing or odd comes back as findings the inbox shows. The refusals are only
 * for a document that cannot be read at all: not XML, not an invoice, no lines.
 *
 * **The supplier's figures are taken as stated.** The same rule as a typed
 * invoice, and for the same reason — `LegalMonetaryTotal` is what we owe, and
 * recomputing it from the lines would replace the document with our arithmetic.
 * `check.ts` then verifies the two agree.
 *
 * **The tax code is ours, not theirs.** A UBL invoice carries a category code
 * and a percentage, which say what the *sender* did. What we may deduct is our
 * question, and the answer depends on what the cost is for — so the parse
 * suggests a code from the category and rate, and the draft is not bookable
 * until a human has looked at the coding. Guessing silently would put a lunch
 * receipt's VAT in rubriek 5b in full.
 */

export type InboundFindingCode =
  | 'no_supplier_identifier'
  | 'unknown_supplier'
  | 'no_invoice_number'
  | 'no_due_date'
  | 'currency_not_functional'
  | 'no_tax_category'
  | 'unmapped_tax_category'
  | 'totals_disagree_with_lines'
  | 'credit_note'

export interface InboundFinding {
  readonly code: InboundFindingCode
  readonly severity: 'blocking' | 'warning' | 'note'
  readonly message: string
}

/** How the sender identifies themselves, in the order a matcher should try. */
export interface InboundSupplier {
  readonly name: string | null
  readonly vatNumber: string | null
  readonly kvkNumber: string | null
  readonly iban: string | null
  /** BT-49: the Peppol participant id, when the document carries one. */
  readonly electronicAddress: string | null
  readonly electronicAddressScheme: string | null
  readonly countryCode: string | null
}

export interface InboundInvoice {
  readonly supplier: InboundSupplier
  /** The draft, with every amount as the document states it. */
  readonly invoice: PurchaseInvoiceInput
  /** What the sender said about the VAT, per line, before we code it. */
  readonly declaredTax: readonly InboundTaxLine[]
  readonly buyerReference: string | null
  readonly paymentReference: string | null
  readonly notes: string | null
  readonly findings: readonly InboundFinding[]
}

export interface InboundTaxLine {
  readonly lineNumber: number
  /** UNCL5305: S, Z, E, AE, K, G, O. */
  readonly categoryCode: string | null
  /** As a percentage string, e.g. `21`. Null when the document omits it. */
  readonly percent: string | null
}

/**
 * A UBL amount to minor units.
 *
 * UBL writes `1210.00` with a point. `parseMinorUnits` reads both separators,
 * but a bare `1210` in a document means twelve hundred and ten euro, not twelve
 * euro ten — which is what it means when a human types it into a form. So the
 * document path is explicit rather than reusing the human one.
 */
function ublAmountToMinorUnits(value: string | null): bigint | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null

  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const cents = `${fraction}00`.slice(0, 2)
  const amount = BigInt(whole) * 100n + BigInt(cents)
  return negative ? -amount : amount
}

/** `21`, `21.00` and `21.0` all mean the same rate. Basis points do not lie. */
function percentToBasisPoints(value: string | null): number | null {
  if (value === null) return null
  const parsed = parseMinorUnits(value.includes('.') ? value : `${value}.00`)
  return parsed === null ? null : Number(parsed)
}

/**
 * Suggest one of our tax codes for a line the sender categorised.
 *
 * A suggestion, never a decision: the category says what the sender did and the
 * code says what we may deduct, and those are different questions. Returns null
 * when nothing fits, which the inbox shows rather than hides.
 */
export function suggestTaxCode(
  candidates: readonly {
    readonly code: string
    readonly rateBasisPoints: number
    readonly direction: 'output' | 'input'
    readonly ublCategory: string
    readonly scope: string
    readonly reverseCharge: string
    readonly deductibility: string
    /**
     * True when another code names this one as its `deductionCode`.
     *
     * The 5b half of a reverse-charge pair looks exactly like an ordinary
     * domestic input code — same scope, same rate, fully deductible — and
     * suggesting it for a normal invoice would put the VAT in rubriek 5b with
     * no matching liability in 2a or 4b. It is only ever reached through the
     * code that pairs with it, so it is never suggested on its own.
     */
    readonly isDeductionHalf?: boolean
  }[],
  line: InboundTaxLine,
): string | null {
  const inputs = candidates.filter(
    (candidate) => candidate.direction === 'input' && candidate.isDeductionHalf !== true,
  )
  if (inputs.length === 0) return null

  const category = (line.categoryCode ?? '').toUpperCase()
  const basisPoints = percentToBasisPoints(line.percent)

  // A reverse charge is unambiguous from the category, and it is the case where
  // guessing wrong costs the most: the VAT is ours to declare, not theirs.
  if (category === 'AE') {
    return (
      inputs.find(
        (candidate) => candidate.reverseCharge !== 'none' && candidate.deductibility === 'full',
      )?.code ?? null
    )
  }
  if (category === 'K') {
    return (
      inputs.find(
        (candidate) =>
          candidate.scope === 'intra_community_acquisition' && candidate.ublCategory === 'K',
      )?.code ?? null
    )
  }

  // Everything else is a domestic purchase at whatever rate the sender used.
  // Fully deductible, because that is the common case and the exceptions
  // (representation, private use) are about what the cost *is*, which no
  // document field records.
  const domestic = inputs.filter(
    (candidate) =>
      candidate.scope === 'domestic' &&
      candidate.reverseCharge === 'none' &&
      candidate.deductibility === 'full',
  )
  if (basisPoints === null) return null
  return domestic.find((candidate) => candidate.rateBasisPoints === basisPoints)?.code ?? null
}

export interface ParseUblInvoiceOptions {
  /** The entity's own currency. A document in another one is a warning. */
  readonly functionalCurrency: string
  /** A cost account to hang every line on until somebody codes it properly. */
  readonly suspenseAccountNumber: string
  /** Our input tax codes, for the suggestion. */
  readonly taxCodes?: readonly Parameters<typeof suggestTaxCode>[0][number][]
}

export function parseUblInvoice(xml: string, options: ParseUblInvoiceOptions): InboundInvoice {
  let root
  try {
    root = parseXmlDocument(xml)
  } catch (error: unknown) {
    throw new LedgerError([
      violation(
        'invalid_document',
        'document',
        `This is not readable XML: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ])
  }

  if (root.name !== 'Invoice' && root.name !== 'CreditNote') {
    throw new LedgerError([
      violation(
        'invalid_document',
        'document',
        `Expected a UBL Invoice or CreditNote, found <${root.name}>.`,
      ),
    ])
  }

  const isCreditNote = root.name === 'CreditNote'
  const findings: InboundFinding[] = []
  const note = (
    code: InboundFindingCode,
    severity: 'blocking' | 'warning' | 'note',
    message: string,
  ): void => {
    findings.push({ code, severity, message })
  }

  // BT-1. Without it there is nothing to identify the document by, and the
  // duplicate guard has nothing to work with.
  const number = textOf(root, 'ID')
  if (number === null) {
    note(
      'no_invoice_number',
      'blocking',
      'The document carries no invoice number (BT-1), so there is nothing to book it under or to recognise it by if it arrives again.',
    )
  }

  const issueDate = textOf(root, 'IssueDate')
  const dueDate = textOf(root, 'DueDate')
  if (dueDate === null) {
    note(
      'no_due_date',
      'warning',
      'The document carries no due date (BT-9). The supplier’s payment terms have been used instead.',
    )
  }

  const currency = textOf(root, 'DocumentCurrencyCode') ?? options.functionalCurrency
  if (currency !== options.functionalCurrency) {
    note(
      'currency_not_functional',
      'warning',
      `The document is in ${currency} and the books are in ${options.functionalCurrency}. The amounts are recorded as stated; the conversion is not done here.`,
    )
  }

  if (isCreditNote) {
    note(
      'credit_note',
      'note',
      'This is a credit note. It reduces what is owed, and its amounts are booked the other way round.',
    )
  }

  const party = at(root, 'AccountingSupplierParty/Party')
  const supplier: InboundSupplier = {
    name:
      (party === undefined ? null : textAt(party, 'PartyName/Name')) ??
      (party === undefined ? null : textAt(party, 'PartyLegalEntity/RegistrationName')),
    vatNumber:
      party === undefined
        ? null
        : (childrenNamed(party, 'PartyTaxScheme')
            .map((scheme) => textOf(scheme, 'CompanyID'))
            .find((value) => value !== null) ?? null),
    kvkNumber: party === undefined ? null : textAt(party, 'PartyLegalEntity/CompanyID'),
    iban: textAt(root, 'PaymentMeans/PayeeFinancialAccount/ID'),
    electronicAddress: party === undefined ? null : textOf(party, 'EndpointID'),
    electronicAddressScheme:
      party === undefined ? null : (child(party, 'EndpointID')?.attributes['schemeID'] ?? null),
    countryCode:
      party === undefined ? null : textAt(party, 'PostalAddress/Country/IdentificationCode'),
  }

  if (
    supplier.vatNumber === null &&
    supplier.kvkNumber === null &&
    supplier.electronicAddress === null
  ) {
    note(
      'no_supplier_identifier',
      'warning',
      'The document identifies its sender by name only — no VAT number, no KvK number, no Peppol address — so it cannot be matched to a supplier automatically.',
    )
  }

  const totals = at(root, 'LegalMonetaryTotal')
  const net = ublAmountToMinorUnits(
    totals === undefined ? null : textOf(totals, 'TaxExclusiveAmount'),
  )
  const gross = ublAmountToMinorUnits(
    totals === undefined ? null : textOf(totals, 'TaxInclusiveAmount'),
  )
  const taxTotal = ublAmountToMinorUnits(textAt(root, 'TaxTotal/TaxAmount'))

  // The invoice lines. `InvoiceLine` on an invoice, `CreditNoteLine` on a
  // credit note — the only structural difference between the two documents.
  const rawLines = childrenNamed(root, isCreditNote ? 'CreditNoteLine' : 'InvoiceLine')
  if (rawLines.length === 0) {
    throw new LedgerError([
      violation('invalid_document', 'lines', 'The document has no invoice lines.'),
    ])
  }

  const declaredTax: InboundTaxLine[] = []
  const lines: PurchaseLineInput[] = rawLines.map((raw, index) => {
    const lineNumber = index + 1
    const category = at(raw, 'Item/ClassifiedTaxCategory')
    const declared: InboundTaxLine = {
      lineNumber,
      categoryCode: category === undefined ? null : textOf(category, 'ID'),
      percent: category === undefined ? null : textOf(category, 'Percent'),
    }
    declaredTax.push(declared)

    const lineNet = ublAmountToMinorUnits(textOf(raw, 'LineExtensionAmount')) ?? 0n

    // The VAT on the line, which UBL does not carry directly: it is the
    // category's percentage of the line. Stated by the sender in the sense
    // that the rate is theirs, so it is derived from their figures only.
    const basisPoints = percentToBasisPoints(declared.percent)
    const lineTax =
      basisPoints === null || declared.categoryCode === 'AE' || declared.categoryCode === 'K'
        ? 0n
        : (lineNet * BigInt(basisPoints)) / 10_000n

    const suggested =
      options.taxCodes === undefined ? null : suggestTaxCode(options.taxCodes, declared)
    if (suggested === null && options.taxCodes !== undefined) {
      note(
        declared.categoryCode === null ? 'no_tax_category' : 'unmapped_tax_category',
        'warning',
        declared.categoryCode === null
          ? `Line ${String(lineNumber)} says nothing about its VAT category, so no tax code could be suggested.`
          : `Line ${String(lineNumber)} is category ${declared.categoryCode} at ${declared.percent ?? '?'}%, and no input tax code matches it. Code it by hand.`,
      )
    }

    return {
      description:
        textOf(raw, 'Note') ??
        (at(raw, 'Item') === undefined ? null : textAt(raw, 'Item/Name')) ??
        `Regel ${String(lineNumber)}`,
      accountNumber: options.suspenseAccountNumber,
      taxCode: suggested ?? '',
      netMinorUnits: lineNet,
      taxMinorUnits: lineTax,
    }
  })

  const lineNet = lines.reduce((sum, line) => sum + line.netMinorUnits, 0n)
  const statedNet = net ?? lineNet
  const statedTax = taxTotal ?? lines.reduce((sum, line) => sum + line.taxMinorUnits, 0n)
  const statedTotal = gross ?? statedNet + statedTax

  if (net !== null && net !== lineNet) {
    note(
      'totals_disagree_with_lines',
      'warning',
      `The document's own total excluding VAT is ${(Number(net) / 100).toFixed(2)} and its lines add up to ${(Number(lineNet) / 100).toFixed(2)}. Both are recorded as they are; the difference is usually a document-level charge or allowance, which is not read here.`,
    )
  }

  const order = { blocking: 0, warning: 1, note: 2 } as const
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return {
    supplier,
    invoice: {
      supplierInvoiceNumber: number ?? '',
      kind: isCreditNote ? 'credit_note' : 'invoice',
      invoiceDate: issueDate ?? '',
      dueDate: dueDate ?? issueDate ?? '',
      currency,
      netMinorUnits: statedNet,
      taxMinorUnits: statedTax,
      totalMinorUnits: statedTotal,
      lines,
    },
    declaredTax,
    buyerReference: textOf(root, 'BuyerReference'),
    // BT-83. What the supplier wants quoted when they are paid.
    paymentReference: textAt(root, 'PaymentMeans/PaymentID'),
    notes: textOf(root, 'Note'),
    findings,
  }
}

/** Whether a parsed document can be turned into a draft at all. */
export function inboundBlockers(parsed: InboundInvoice): readonly LedgerViolation[] {
  return parsed.findings
    .filter((finding) => finding.severity === 'blocking')
    .map((finding) => violation('invalid_document', `document.${finding.code}`, finding.message))
}
