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

/** Privégebruik is not a sales-line choice — drop it from the guided picker. */
export const SALES_PICKER_EXCLUDED = new Set(['PRIV21'])

/**
 * Zero-rate sales codes that must each keep a distinct plain-Dutch label
 * (they land in different aangifte boxes).
 */
export const ZERO_RATE_SALES_CODES = ['VERL', 'GEEN', 'NUL', 'ICP', 'ICPD'] as const

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
  description?: string
}

export interface GuidedTotals {
  net: bigint
  tax: bigint
  total: bigint
  /** Rate label → tax amount, for the summary rows (e.g. `9% btw`). */
  taxByLabel: ReadonlyArray<{ label: string; amount: bigint }>
}

export type VatLabelBag = {
  rate: (rate: string) => string
  /** Distinct labels keyed by tax code (VERL, GEEN, …). */
  byCode: Readonly<Partial<Record<string, string>>>
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

/** Output codes offered on a sales invoice (no PRIV21). */
export function salesPickerTaxCodes(codes: readonly GuidedTaxCode[]): GuidedTaxCode[] {
  return codes.filter(
    (code) => code.direction === 'output' && !SALES_PICKER_EXCLUDED.has(code.code),
  )
}

/**
 * Plain VAT label for simple mode — never the ledger code.
 * Zero-rate codes use their own translated label; positive rates use `{rate}% btw`.
 */
export function taxCodeLabel(code: GuidedTaxCode | undefined, labels: VatLabelBag): string {
  if (code === undefined) return labels.byCode['GEEN'] ?? ''
  const named = labels.byCode[code.code]
  if (named !== undefined) return named
  if (isZeroVatRate(code.ratePercent)) return labels.byCode['GEEN'] ?? code.description ?? ''
  return labels.rate(formatRatePercent(code.ratePercent))
}

/**
 * Default output tax code: highest *positive* sales rate. Never preselects a
 * 0% code or PRIV21. Last-booking defaults are not available from the API yet.
 */
export function defaultOutputTaxCode(codes: readonly GuidedTaxCode[]): string {
  const eligible = salesPickerTaxCodes(codes).filter((code) => !isZeroVatRate(code.ratePercent))
  return [...eligible].sort((a, b) => b.rateBasisPoints - a.rateBasisPoints)[0]?.code ?? ''
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

/** Parse `01-11-2026` or `1-11-2026` back to ISO. */
export function parseDateShort(display: string): string | null {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(display.trim())
  if (match === null) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${String(year)}-${m}-${d}`
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

/** Client-side indicative totals (per-line VAT). Prefer server totals on step 3+. */
export function computeGuidedTotals(
  lines: readonly GuidedLineDraft[],
  codes: readonly GuidedTaxCode[],
  vatLabels: VatLabelBag,
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

export function filterCustomers<
  T extends { name: string; number: string; email: string | null; city?: string | null },
>(customers: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...customers]
  return customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(q) ||
      customer.number.toLowerCase().includes(q) ||
      (customer.email?.toLowerCase().includes(q) ?? false) ||
      (customer.city?.toLowerCase().includes(q) ?? false),
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

export function isPeriodLockCode(code: string): boolean {
  return code === 'period_hard_closed' || code === 'period_soft_closed'
}
