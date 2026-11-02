import type { VatPeriodKind } from '@klopt/core'
import type { MessageKey } from '~/i18n/nl'

/**
 * VAT screen helpers for the redesign (#132 / #107 Phase 8).
 *
 * Period status, short rail labels, collapsing empty boxes, and picking which
 * period `/vat` should open. Status colours follow the export StatusPill only:
 * success / danger / info / draft (neutral). Honest copy never claims Klopt
 * submitted to the Belastingdienst.
 */

export interface VatPeriodRow {
  readonly code: string
  readonly kind: VatPeriodKind
  readonly label: string
  readonly from: string
  readonly to: string
  readonly deadline: string
  readonly filed: boolean
  readonly sequence: number
  readonly filedAt: string | null
  readonly payable: string | null
}

export type VatPeriodTone = 'success' | 'danger' | 'info' | 'draft' | 'muted'

export type VatPeriodStatus =
  | { readonly kind: 'marked'; readonly tone: 'success'; readonly labelKey: MessageKey }
  | { readonly kind: 'late'; readonly tone: 'danger'; readonly labelKey: MessageKey }
  | {
      readonly kind: 'dueSoon'
      readonly tone: 'info'
      readonly labelKey: MessageKey
      readonly days: number
    }
  | { readonly kind: 'ready'; readonly tone: 'draft'; readonly labelKey: MessageKey }
  | {
      readonly kind: 'opens'
      readonly tone: 'muted'
      readonly labelKey: MessageKey
      readonly opensOn: string
    }
  | { readonly kind: 'open'; readonly tone: 'info'; readonly labelKey: MessageKey }

/** Calendar day comparison on ISO dates (`YYYY-MM-DD`), UTC-safe. */
export function daysBetweenIso(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`)
  const end = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.round((end - start) / 86_400_000)
}

const OPENS_MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const OPENS_MONTHS_NL = [
  'jan',
  'feb',
  'mrt',
  'apr',
  'mei',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec',
] as const

/**
 * Short day+month for the period-rail "Opens …" sample, matching the Vat board
 * (`Opens 1 Jan`) — not a full `DD-MM-YYYY`, which made the rail look wrong.
 */
export function formatVatOpensDate(iso: string, locale: 'nl' | 'en'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const month = Number(match[2])
  const day = Number(match[3])
  const months = locale === 'en' ? OPENS_MONTHS_EN : OPENS_MONTHS_NL
  const name = months[month - 1]
  if (name === undefined || day < 1 || day > 31) return iso
  return `${String(day)} ${name}`
}

const HEADER_MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const HEADER_MONTHS_NL = [
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

/**
 * Long day+month+year for the VAT header intro, matching the Vat board
 * (`file and pay by 31 January 2026`). Kept on one line at 1440 via nowrap.
 */
export function formatVatHeaderDate(iso: string, locale: 'nl' | 'en'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  const year = match[1]!
  const month = Number(match[2])
  const day = Number(match[3])
  const months = locale === 'en' ? HEADER_MONTHS_EN : HEADER_MONTHS_NL
  const name = months[month - 1]
  if (name === undefined || day < 1 || day > 31) return iso
  return `${String(day)} ${name} ${year}`
}

/**
 * Status for one period on the rail and in pills.
 *
 * Marked-as-filed wins. Future periods say when they open. After the deadline
 * without a mark → late. After the period ends but before the deadline → ready
 * to file (or due tomorrow when one day remains).
 */
export function vatPeriodStatus(period: VatPeriodRow, todayIso: string): VatPeriodStatus {
  if (period.filed) {
    return { kind: 'marked', tone: 'success', labelKey: 'vat.status.marked' }
  }
  if (todayIso < period.from) {
    return {
      kind: 'opens',
      tone: 'muted',
      labelKey: 'vat.status.opens',
      opensOn: period.from,
    }
  }
  if (todayIso > period.deadline) {
    return { kind: 'late', tone: 'danger', labelKey: 'vat.status.late' }
  }
  if (todayIso > period.to) {
    const daysLeft = daysBetweenIso(todayIso, period.deadline)
    if (daysLeft <= 1) {
      return {
        kind: 'dueSoon',
        tone: 'info',
        labelKey: daysLeft <= 0 ? 'vat.status.dueToday' : 'vat.status.dueTomorrow',
        days: daysLeft,
      }
    }
    return { kind: 'ready', tone: 'draft', labelKey: 'vat.status.ready' }
  }
  return { kind: 'open', tone: 'info', labelKey: 'vat.status.open' }
}

/** Short rail label: `Q1`, `03`, or the year for annual. */
export function vatPeriodShortLabel(kind: VatPeriodKind, code: string): string {
  const [, rest] = code.split('-')
  if (kind === 'annual') return code
  if (kind === 'quarterly') return rest?.startsWith('Q') ? rest : `Q${rest ?? ''}`
  return rest ?? code
}

export interface RubriekRow {
  readonly id: string
  readonly label: string
  readonly carries: 'base' | 'vat' | 'both'
  readonly computed: boolean
  readonly base: string
  readonly vat: string
}

export interface CollapsedRubrieken {
  readonly visible: readonly RubriekRow[]
  readonly emptyCount: number
  readonly emptyIds: readonly string[]
}

/**
 * Keep computed subtotals and non-zero boxes; collapse the rest into one row
 * ("N other boxes are empty") like the export.
 */
export function collapseEmptyRubrieken(
  rows: readonly RubriekRow[],
  showEmpty: boolean,
): CollapsedRubrieken {
  const empty = rows.filter((row) => !row.computed && row.base === '0' && row.vat === '0')
  if (showEmpty || empty.length === 0) {
    return { visible: rows, emptyCount: empty.length, emptyIds: empty.map((row) => row.id) }
  }
  const emptyIds = new Set(empty.map((row) => row.id))
  return {
    visible: rows.filter((row) => !emptyIds.has(row.id)),
    emptyCount: empty.length,
    emptyIds: empty.map((row) => row.id),
  }
}

/**
 * Which period `/vat` should open: most recent ended unfiled, else the period
 * that contains today, else the last period of the year.
 */
export function pickDefaultVatPeriod(
  periods: readonly VatPeriodRow[],
  todayIso: string,
): string | null {
  if (periods.length === 0) return null

  const endedUnfiled = periods
    .filter((period) => !period.filed && period.to < todayIso)
    .sort((a, b) => (a.to < b.to ? 1 : -1))
  const firstEnded = endedUnfiled[0]
  if (firstEnded !== undefined) return firstEnded.code

  const current = periods.find((period) => period.from <= todayIso && todayIso <= period.to)
  if (current !== undefined) return current.code

  const last = periods[periods.length - 1]
  return last?.code ?? null
}

export interface VatTransport {
  readonly kind: string
  readonly available: boolean
}

/** Digipoort / SBR ready on this install — only then show electronic submit. */
export function canSubmitElectronically(transports: readonly VatTransport[]): boolean {
  return transports.some(
    (transport) =>
      transport.available && (transport.kind === 'digipoort' || transport.kind === 'sbr_provider'),
  )
}

/** Group periods newest-year-first for the rail. */
export function groupPeriodsByYear(
  periods: readonly VatPeriodRow[],
): readonly { readonly year: number; readonly periods: readonly VatPeriodRow[] }[] {
  const byYear = new Map<number, VatPeriodRow[]>()
  for (const period of periods) {
    const year = Number(period.code.slice(0, 4))
    const list = byYear.get(year) ?? []
    list.push(period)
    byYear.set(year, list)
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, rows]) => ({
      year,
      // Newest period first in the rail (Q4 above Q1), matching the export.
      periods: [...rows].sort((a, b) => (a.from < b.from ? 1 : -1)),
    }))
}

/** Build a plain-text summary for typing into Mijn Belastingdienst Zakelijk. */
export function manualFilingSummaryText(input: {
  readonly periodLabel: string
  readonly from: string
  readonly to: string
  readonly deadline: string
  readonly rubrieken: readonly RubriekRow[]
  readonly payable: string
  readonly currencyLabel?: string
}): string {
  const lines: string[] = [
    'AANGIFTE OMZETBELASTING',
    input.periodLabel,
    `${input.from} – ${input.to}`,
    `Uiterlijk ${input.deadline}`,
    '',
  ]
  for (const row of input.rubrieken) {
    const base = row.carries === 'vat' ? '' : ` grondslag ${row.base}`
    const vat = row.carries === 'base' ? '' : ` btw ${row.vat}`
    lines.push(`${row.id} ${row.label}:${base}${vat}`)
  }
  lines.push('')
  lines.push(`Te betalen: ${input.payable} ${input.currencyLabel ?? 'eurocent'}`)
  lines.push('')
  lines.push('Cijfers uit Klopt. Zelf indienen via Mijn Belastingdienst Zakelijk.')
  return `${lines.join('\n')}\n`
}
