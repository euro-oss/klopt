import type {
  UblAddress,
  UblDocument,
  UblLine,
  UblParty,
  UblPaymentMeans,
  UblProfile,
  UblTaxSubtotal,
} from './model.js'

/**
 * Our invoice, as a UBL document.
 *
 * The input is deliberately plain — strings, bigints and nulls, no database
 * rows — so that the mapping is testable without Postgres and the generator
 * stays in `@klopt/core` where the boundary rules keep it honest.
 *
 * The **totals come from the stored invoice**, not from re-adding the lines.
 * That is not laziness: if the two disagree, the rule check reports it as
 * BR-CO-10 or BR-S-08 with the official wording, which is exactly what it is —
 * an invoice whose stated total is not the sum of its lines. Recomputing them
 * here would paper over a real defect and produce a document that validates and
 * is wrong.
 */

export interface UblPartySource {
  readonly legalName: string
  readonly tradingName: string | null
  readonly street: string | null
  readonly houseNumber: string | null
  readonly postalCode: string | null
  readonly city: string | null
  readonly countryCode: string
  readonly vatNumber: string | null
  readonly kvkNumber: string | null
  readonly electronicAddress: string | null
  readonly electronicAddressScheme: string | null
  readonly contactName: string | null
  readonly phone: string | null
  readonly email: string | null
}

export interface UblLineSource {
  readonly lineNumber: number
  readonly description: string
  readonly quantity: string
  readonly unitCode: string
  readonly unitPrice: bigint
  readonly net: bigint
  readonly tax: bigint
  readonly ublCategory: string
  readonly rateBasisPoints: number
  /** The tax code's own description, used as the exemption reason for `E`. */
  readonly taxDescription: string
}

export interface UblInvoiceSource {
  readonly profile: UblProfile
  readonly kind: 'invoice' | 'credit_note'
  readonly number: string
  readonly issueDate: string
  readonly dueDate: string
  readonly currency: string
  readonly buyerReference: string | null
  readonly orderReference: string | null
  readonly note: string | null
  readonly precedingInvoiceNumber: string | null
  readonly precedingInvoiceIssueDate: string | null
  readonly seller: UblPartySource
  readonly buyer: UblPartySource
  readonly iban: string | null
  readonly bic: string | null
  /** Stored on the invoice, and authoritative. See the note above. */
  readonly net: bigint
  readonly tax: bigint
  readonly total: bigint
  readonly lines: readonly UblLineSource[]
}

/**
 * The exemption reason a category needs to be legal.
 *
 * `Z` is absent on purpose: a zero rate is a rate, not an exemption, and
 * EN 16931 asks for no reason at all. `E` is absent because the reason depends
 * on which article of the Wet OB applies, which only the tax code knows — so it
 * falls back to the tax code's own description.
 */
const EXEMPTION: Readonly<Record<string, { code: string; reason: string }>> = {
  AE: { code: 'VATEX-EU-AE', reason: 'Reverse charge' },
  K: { code: 'VATEX-EU-IC', reason: 'Intra-Community supply' },
  G: { code: 'VATEX-EU-G', reason: 'Export outside the EU' },
}

function addressOf(party: UblPartySource): UblAddress {
  const street =
    party.street === null
      ? null
      : party.houseNumber === null
        ? party.street
        : `${party.street} ${party.houseNumber}`

  return {
    street,
    additionalStreet: null,
    city: party.city,
    postalZone: party.postalCode,
    countrySubentity: null,
    countryCode: party.countryCode.toUpperCase(),
  }
}

function partyOf(party: UblPartySource): UblParty {
  // A Dutch legal registration identifier is a KvK number in scheme 0106.
  // NL-R-003 and NL-R-005 accept only 0106 or 0190, so guessing anything else
  // would produce a document that fails validation with a confusing message.
  const scheme = party.kvkNumber === null ? null : '0106'

  return {
    electronicAddress: party.electronicAddress,
    electronicAddressScheme: party.electronicAddressScheme,
    tradingName: party.tradingName,
    legalName: party.legalName,
    address: addressOf(party),
    vatNumber: party.vatNumber,
    registrationNumber: party.kvkNumber,
    registrationScheme: scheme,
    contactName: party.contactName,
    contactPhone: party.phone,
    contactEmail: party.email,
  }
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

export function toUblDocument(source: UblInvoiceSource): UblDocument {
  const lines: UblLine[] = source.lines.map((line) => ({
    id: String(line.lineNumber),
    quantity: line.quantity,
    unitCode: line.unitCode,
    netAmount: line.net,
    name: line.description,
    // BT-153 is the item name and BT-154 its description. We hold one string,
    // and duplicating it into both reads badly in every rendering there is.
    description: null,
    unitPrice: line.unitPrice,
    categoryCode: line.ublCategory,
    rateBasisPoints: line.rateBasisPoints,
    accountingCost: null,
  }))

  // One VAT breakdown row per (category, rate). Insertion-ordered, so the
  // output follows the order the lines were entered in.
  const groups = new Map<string, UblTaxSubtotal>()
  for (const line of source.lines) {
    const key = `${line.ublCategory}:${String(line.rateBasisPoints)}`
    const existing = groups.get(key)
    const exemption = EXEMPTION[line.ublCategory]

    groups.set(key, {
      taxableAmount: (existing?.taxableAmount ?? 0n) + line.net,
      taxAmount: (existing?.taxAmount ?? 0n) + line.tax,
      categoryCode: line.ublCategory,
      rateBasisPoints: line.rateBasisPoints,
      exemptionReason: exemption?.reason ?? (line.ublCategory === 'E' ? line.taxDescription : null),
      exemptionReasonCode: exemption?.code ?? null,
    })
  }

  const paymentMeans: UblPaymentMeans | null =
    source.iban === null
      ? null
      : {
          // 58 is a SEPA credit transfer, which is what a Dutch IBAN means.
          code: '58',
          remittanceInformation: source.number,
          iban: source.iban,
          bic: source.bic,
          accountName: source.seller.legalName,
        }

  const days = daysBetween(source.issueDate, source.dueDate)

  return {
    profile: source.profile,
    kind: source.kind,
    number: source.number,
    issueDate: source.issueDate,
    dueDate: source.kind === 'invoice' ? source.dueDate : null,
    currency: source.currency,
    buyerReference: source.buyerReference,
    orderReference: source.orderReference,
    note: source.note,
    precedingInvoiceNumber: source.precedingInvoiceNumber,
    precedingInvoiceIssueDate: source.precedingInvoiceIssueDate,
    seller: partyOf(source.seller),
    buyer: partyOf(source.buyer),
    paymentMeans: source.kind === 'invoice' ? paymentMeans : null,
    paymentTerms:
      source.kind === 'invoice' ? `Betaling binnen ${String(days)} dagen na factuurdatum.` : null,
    taxSubtotals: [...groups.values()],
    taxTotal: source.tax,
    lineTotal: source.net,
    taxExclusiveTotal: source.net,
    taxInclusiveTotal: source.total,
    prepaidAmount: 0n,
    payableAmount: source.total,
    lines,
  }
}
