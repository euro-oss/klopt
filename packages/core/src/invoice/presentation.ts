import { formatDate, formatMinorUnits } from '../format/index.js'
import type { UblInvoiceSource, UblPartySource } from '../ubl/from-invoice.js'

/**
 * An invoice, laid out for a human.
 *
 * "The XML is the legal invoice, the PDF is a rendering" (spec 7.5). This is
 * the rendering, and it is built from **the same source the XML is** — one read
 * feeds both, so the document a customer looks at and the document their system
 * parses cannot disagree about the amounts. That property is worth more than
 * any amount of layout flexibility.
 *
 * Everything here is a finished string. The renderer places text and draws
 * lines; it makes no decisions about wording, formatting or what a reverse
 * charge obliges you to print. Those are rules, and rules live here.
 */

export interface PresentedParty {
  readonly name: string
  /** Ready to print, one per line, with nothing empty in between. */
  readonly addressLines: readonly string[]
  readonly identifiers: readonly string[]
}

export interface PresentedRow {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCode: string
  readonly net: string
}

export interface PresentedAmount {
  readonly label: string
  readonly amount: string
  readonly emphasis?: boolean
}

export interface PresentedTaxRow {
  readonly label: string
  readonly base: string
  readonly amount: string
}

export interface InvoicePresentation {
  /** `Factuur` or `Creditnota`. */
  readonly title: string
  readonly number: string
  readonly seller: PresentedParty
  readonly buyer: PresentedParty
  /** Date, due date, references — label and value, in reading order. */
  readonly meta: readonly { label: string; value: string }[]
  readonly rows: readonly PresentedRow[]
  readonly taxRows: readonly PresentedTaxRow[]
  readonly totals: readonly PresentedAmount[]
  /**
   * What the law requires printing when VAT is not charged at a normal rate.
   * Wet OB 1968 art. 35a: an invoice with no VAT must say on what grounds.
   */
  readonly notices: readonly string[]
  readonly payment: string | null
  readonly notes: string | null
  readonly currency: string
}

/** The wording a zero-rated category obliges the invoice to carry. */
const NOTICE: Readonly<Record<string, string>> = {
  AE: 'Btw verlegd.',
  K: 'Intracommunautaire levering. Btw verlegd naar de afnemer.',
  G: 'Uitvoer buiten de EU. 0% btw.',
  Z: '0% btw.',
}

function lines(...values: (string | null)[]): string[] {
  return values.map((value) => (value ?? '').trim()).filter((value) => value !== '')
}

function partyOf(
  party: UblPartySource,
  labels: { vat: string; registration: string },
): PresentedParty {
  const street =
    party.street === null
      ? null
      : party.houseNumber === null
        ? party.street
        : `${party.street} ${party.houseNumber}`

  return {
    name: party.tradingName ?? party.legalName,
    addressLines: lines(
      // The statutory name, but only when it differs — printing the same name
      // twice makes a letterhead look like a mistake.
      party.tradingName !== null && party.tradingName !== party.legalName ? party.legalName : null,
      street,
      lines(party.postalCode, party.city).join('  '),
      party.countryCode.toUpperCase() === 'NL' ? null : party.countryCode.toUpperCase(),
    ),
    identifiers: lines(
      party.vatNumber === null ? null : `${labels.vat} ${party.vatNumber}`,
      party.kvkNumber === null ? null : `${labels.registration} ${party.kvkNumber}`,
    ),
  }
}

export function presentInvoice(source: UblInvoiceSource): InvoicePresentation {
  const credit = source.kind === 'credit_note'
  const money = (value: bigint): string => formatMinorUnits(value)

  const meta: { label: string; value: string }[] = [
    { label: credit ? 'Creditnotadatum' : 'Factuurdatum', value: formatDate(source.issueDate) },
  ]
  // A credit note has no due date: there is nothing to pay by.
  if (!credit) meta.push({ label: 'Vervaldatum', value: formatDate(source.dueDate) })
  if (source.buyerReference !== null) {
    meta.push({ label: 'Uw referentie', value: source.buyerReference })
  }
  if (source.orderReference !== null) {
    meta.push({ label: 'Inkoopnummer', value: source.orderReference })
  }
  if (source.precedingInvoiceNumber !== null) {
    meta.push({
      label: 'Betreft factuur',
      value:
        source.precedingInvoiceIssueDate === null
          ? source.precedingInvoiceNumber
          : `${source.precedingInvoiceNumber} van ${formatDate(source.precedingInvoiceIssueDate)}`,
    })
  }

  // One row per (category, rate), in the order the lines introduced them —
  // the same grouping the XML's VAT breakdown uses, for the same reason.
  const groups = new Map<string, { label: string; base: bigint; amount: bigint }>()
  for (const line of source.lines) {
    const key = `${line.ublCategory}:${String(line.rateBasisPoints)}`
    const existing = groups.get(key)
    const percent = (line.rateBasisPoints / 100).toString()
    groups.set(key, {
      label: `Btw ${percent}%`,
      base: (existing?.base ?? 0n) + line.net,
      amount: (existing?.amount ?? 0n) + line.tax,
    })
  }

  const categories = new Set(source.lines.map((line) => line.ublCategory))
  const notices = lines(
    ...[...categories].map((category) => NOTICE[category] ?? null),
    // An exempt line's grounds come from the tax code itself: only it knows
    // which article of the Wet OB applies.
    ...source.lines
      .filter((line) => line.ublCategory === 'E')
      .map((line) => `Vrijgesteld van btw: ${line.taxDescription}.`),
  )

  const days = Math.round(
    (Date.parse(`${source.dueDate}T00:00:00Z`) - Date.parse(`${source.issueDate}T00:00:00Z`)) /
      86_400_000,
  )

  const payment =
    credit || source.iban === null
      ? null
      : `Gelieve ${money(source.total)} ${source.currency} binnen ${String(days)} dagen te ` +
        `voldoen op ${source.iban} ten name van ${source.seller.legalName}, ` +
        `onder vermelding van ${source.number}.`

  return {
    title: credit ? 'Creditnota' : 'Factuur',
    number: source.number,
    seller: partyOf(source.seller, { vat: 'Btw-nr.', registration: 'KvK' }),
    buyer: partyOf(source.buyer, { vat: 'Btw-nr.', registration: 'KvK' }),
    meta,
    rows: source.lines.map((line) => ({
      description: line.description,
      quantity: `${line.quantity} ${line.unitCode}`,
      unitPrice: money(line.unitPrice),
      taxCode: `${(line.rateBasisPoints / 100).toString()}%`,
      net: money(line.net),
    })),
    taxRows: [...groups.values()].map((group) => ({
      label: group.label,
      base: money(group.base),
      amount: money(group.amount),
    })),
    totals: [
      { label: 'Subtotaal', amount: money(source.net) },
      { label: 'Btw', amount: money(source.tax) },
      {
        label: credit ? 'Te crediteren' : 'Te betalen',
        amount: money(source.total),
        emphasis: true,
      },
    ],
    notices,
    payment,
    notes: source.note,
    currency: source.currency,
  }
}
