/**
 * Pure helpers for the guided sales-invoice flow (#45 / redesign slice 5).
 *
 * Keeps step math, money preview and plain-Dutch VAT labels out of the React
 * tree so unit tests can pin behaviour without a browser.
 */

import {
  formatDate,
  formatMinorUnits,
  multiplyByDecimal,
  percentOf,
  parseMinorUnits,
} from './format'

/** Non-breaking space after the euro sign (same convention as the dashboard PR). */
export const EURO_NBSP = '€\u00a0'

export type GuidedStep = 1 | 2 | 3 | 4

export const GUIDED_STEP_COUNT = 4

export const GUIDED_STEP_KEYS = [
  'invoiceGuided.step.customer',
  'invoiceGuided.step.lines',
  'invoiceGuided.step.review',
  'invoiceGuided.step.send',
] as const

export type GuidedSendMethod = 'email' | 'pdf'

export interface GuidedLineDraft {
  description: string
  quantity: string
  /** Euro amount the user typed, e.g. `4,20`. */
  unitPrice: string
  taxCode: string
  revenueAccountNumber: string
}

export interface GuidedTaxCode {
  code: string
  ratePercent: string
  rateBasisPoints: number
  direction: string
}

export interface GuidedTotals {
  net: bigint
  tax: bigint
  total: bigint
  /** Rate label → tax amount, for the summary rows (e.g. `9% btw`). */
  taxByLabel: ReadonlyArray<{ label: string; amount: bigint }>
}

/** Format minor units with a non-breaking space after €. Never invents a figure. */
export function formatEuro(minorUnits: bigint): string {
  return `${EURO_NBSP}${formatMinorUnits(minorUnits)}`
}

/** Display form of a rate percent string (`21.00` → `21`). */
export function formatRatePercent(ratePercent: string): string {
  const trimmed = ratePercent.trim()
  if (trimmed === '') return '0'
  const display = trimmed.replace(/\.00$/, '').replace(/,/g, '.')
  return display.includes('.') ? display.replace('.', ',') : display
}

export function isZeroVatRate(ratePercent: string): boolean {
  const trimmed = ratePercent.trim()
  return trimmed === '' || trimmed === '0' || trimmed === '0.00' || trimmed === '0,00'
}

/**
 * Plain VAT label for simple mode — rate only, never the ledger code.
 * Callers pass translated none / rate templates.
 */
export function taxCodeLabel(
  code: GuidedTaxCode | undefined,
  labels: { none: string; rate: (rate: string) => string },
): string {
  if (code === undefined || isZeroVatRate(code.ratePercent)) return labels.none
  return labels.rate(formatRatePercent(code.ratePercent))
}

/**
 * Pick the default output tax code: highest rate (same rule as the advanced
 * form). Last-booking defaults are not available from the API yet — TODO.
 */
export function defaultOutputTaxCode(codes: readonly GuidedTaxCode[]): string {
  const output = codes.filter((code) => code.direction === 'output')
  return [...output].sort((a, b) => b.rateBasisPoints - a.rateBasisPoints)[0]?.code ?? ''
}

export function addDaysIso(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (match === null) return isoDate
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${String(y)}-${m}-${d}`
}

/** Display `2026-11-01` as `01-11-2026`. */
export function formatDateShort(iso: string): string {
  return formatDate(iso)
}

const MONTHS_NL = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
] as const

/** Long Dutch date without a year when the year is obvious, else with year. */
export function formatDateLongNl(iso: string, opts?: { includeYear?: boolean }): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const year = match[1]!
  const month = Number(match[2])
  const day = Number(match[3])
  const monthName = MONTHS_NL[month - 1]
  if (monthName === undefined) return iso
  const dayText = String(day)
  if (opts?.includeYear === false) return `${dayText} ${monthName}`
  return `${dayText} ${monthName} ${year}`
}

export function computeGuidedTotals(
  lines: readonly GuidedLineDraft[],
  codes: readonly GuidedTaxCode[],
  vatLabels: { none: string; rate: (rate: string) => string },
): GuidedTotals {
  const rateOf = (code: string): string =>
    codes.find((item) => item.code === code)?.ratePercent ?? '0'

  let net = 0n
  let tax = 0n
  const byLabel = new Map<string, bigint>()

  for (const line of lines) {
    if (line.description.trim() === '') continue
    const lineNet = multiplyByDecimal(
      parseMinorUnits(line.unitPrice) ?? 0n,
      line.quantity === '' ? '0' : line.quantity,
    )
    const lineTax = percentOf(lineNet, rateOf(line.taxCode))
    net += lineNet
    tax += lineTax
    const label = taxCodeLabel(
      codes.find((item) => item.code === line.taxCode),
      vatLabels,
    )
    byLabel.set(label, (byLabel.get(label) ?? 0n) + lineTax)
  }

  return {
    net,
    tax,
    total: net + tax,
    taxByLabel: [...byLabel.entries()]
      .filter(([, amount]) => amount !== 0n)
      .map(([label, amount]) => ({ label, amount })),
  }
}

export function filterCustomers<T extends { name: string; number: string; email: string | null }>(
  customers: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...customers]
  return customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(q) ||
      customer.number.toLowerCase().includes(q) ||
      (customer.email?.toLowerCase().includes(q) ?? false),
  )
}

export function canAdvanceFromStep(
  step: GuidedStep,
  state: {
    contactNumber: string
    lines: readonly GuidedLineDraft[]
    sendMethod: GuidedSendMethod | null
  },
): boolean {
  if (step === 1) return state.contactNumber !== ''
  if (step === 2) {
    return state.lines.some(
      (line) => line.description.trim() !== '' && (parseMinorUnits(line.unitPrice) ?? 0n) > 0n,
    )
  }
  if (step === 3) return true
  return state.sendMethod !== null
}

export function nextStep(step: GuidedStep): GuidedStep | null {
  if (step >= GUIDED_STEP_COUNT) return null
  return (step + 1) as GuidedStep
}

export function prevStep(step: GuidedStep): GuidedStep | null {
  if (step <= 1) return null
  return (step - 1) as GuidedStep
}

/** Seller address lines for the preview — omit blanks; never invent. */
export function sellerAddressLines(entity: {
  street: string | null
  houseNumber: string | null
  postalCode: string | null
  city: string | null
}): string[] {
  const street = [entity.street, entity.houseNumber].filter(Boolean).join(' ').trim()
  const city = [entity.postalCode, entity.city].filter(Boolean).join(' ').trim()
  return [street, city].filter((line) => line !== '')
}

export function buyerAddressLines(
  address: {
    street: string | null
    houseNumber: string | null
    postalCode: string | null
    city: string | null
  } | null,
): string[] {
  if (address === null) return []
  return sellerAddressLines(address)
}

export function sellerIdentifiers(entity: {
  kvkNumber: string | null
  vatNumber: string | null
}): string {
  const parts: string[] = []
  if (entity.kvkNumber) parts.push(`KvK ${entity.kvkNumber}`)
  if (entity.vatNumber) parts.push(entity.vatNumber)
  return parts.join(' · ')
}
