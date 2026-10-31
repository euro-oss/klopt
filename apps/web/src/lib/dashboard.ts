/**
 * Dashboard presentation helpers for the redesign werklijst (#61 slice 3).
 *
 * Pure functions over plain data so unit tests can name dates and amounts
 * without rendering a page. Copy and routing stay in the route / i18n.
 */

import type { MessageKey } from '~/i18n/nl'
import type { WorkQueueDetail, WorkQueueKind } from './work-queue'
import { formatMinorUnits } from './format'

type Translate = (key: MessageKey, vars?: Record<string, string>) => string
type Plural = (key: string, count: number, values?: Record<string, string | number>) => string

/**
 * Severity colour on a Home to-do tile.
 * Maps to export `.k-tile--danger|brand|info` (or neutral). Yellow is accent /
 * brand tile only — never a severity for "money has gone wrong".
 */
export type AttentionTone = 'error' | 'attention' | 'info' | 'neutral' | 'brand'

export const ATTENTION_TONE: Readonly<Record<WorkQueueKind, AttentionTone>> = {
  'import.blocking': 'error',
  'sales.overdue': 'error',
  'dunning.waiting': 'attention',
  'bank.unmatched': 'brand',
  'purchase.approve': 'info',
  'purchase.book': 'neutral',
  'vat.filing': 'neutral',
  'sales.draft': 'neutral',
  'inbox.waiting': 'neutral',
}

/** Width of a P&L glance bar as a percentage of the larger of income/expenses. */
export function glanceBarPercent(value: string, max: bigint): number {
  if (max <= 0n) return 0
  const amount = BigInt(value)
  if (amount <= 0n) return 0
  const pct = Number((amount * 1000n) / max) / 10
  return Math.min(100, Math.max(2, pct))
}

/**
 * First name for "Goedemorgen, Hidde" — the part before the first space.
 * Magic-link sign-in often leaves `name` empty; never fall back to the email
 * local-part (that wraps into four lines on phone). Caller shows a bare
 * greeting without a comma when this returns null.
 */
export function greetingName(fullName: string): string | null {
  const trimmed = fullName.trim()
  if (trimmed === '') return null
  const first = trimmed.split(/\s+/)[0]
  return first === undefined || first === '' ? trimmed : first
}

/** Capitalise the first letter — weekdays and full month names in the subline. */
export function capitalizeWord(value: string): string {
  if (value.length === 0) return value
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

/** Calendar parts from an ISO `YYYY-MM-DD` (local calendar, not UTC). */
export function calendarParts(iso: string): {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly weekday: number
} {
  const [yearText, monthText, dayText] = iso.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(year, month - 1, day)
  return { year, month, day, weekday: date.getDay() }
}

export type DayPart = 'morning' | 'afternoon' | 'evening'

/** Local clock hour → day part for the greeting. */
export function dayPartAt(hour: number): DayPart {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/**
 * How a kerncijfer tile renders its value line (PM #112):
 * - `omit` — no data yet (no bank account, no statement): drop the value line
 * - `empty` — read failed: leave the value empty, show Unavailable meta
 * - `amount` — show the money
 */
export type FigureValueKind = 'omit' | 'empty' | 'amount'

export function bankFigureValueKind(
  bank:
    | null
    | { readonly status: 'unavailable' }
    | { readonly status: 'ok'; readonly balance: string | null },
): FigureValueKind {
  if (bank === null) return 'omit'
  if (bank.status === 'unavailable') return 'empty'
  if (bank.balance === null) return 'omit'
  return 'amount'
}

export function payablesFigureValueKind(total: string | null): FigureValueKind {
  return total === null ? 'empty' : 'amount'
}

export function profitFigureValueKind(result: string | null): FigureValueKind {
  return result === null ? 'empty' : 'amount'
}

/**
 * Home to-do body copy (PM #112): never invent a dash or a 0 when the invoice
 * number, days overdue, or VAT deadline is missing — drop that clause instead.
 * Days use `_one`/`_other` via `plural` (Legal #112).
 */
export function homeQueueOverdueOneBody(
  detail: WorkQueueDetail,
  t: Translate,
  plural: Plural,
): string {
  const number =
    detail.invoiceNumber !== undefined && detail.invoiceNumber.trim() !== ''
      ? detail.invoiceNumber
      : null
  // Never surface a placeholder 0 — treat missing/non-positive as "no days clause".
  const days =
    detail.daysOverdue !== undefined &&
    Number.isFinite(detail.daysOverdue) &&
    detail.daysOverdue > 0
      ? detail.daysOverdue
      : null
  if (number !== null && days !== null) {
    return plural('queue.salesOverdueOneBody', days, { number, days: String(days) })
  }
  if (number !== null) return t('queue.salesOverdueOneBodyNumber', { number })
  if (days !== null) {
    return plural('queue.salesOverdueOneBodyDays', days, { days: String(days) })
  }
  return t('queue.salesOverdueBody')
}

/** `null` when the deadline is absent — caller drops the deadline clause. */
export function homeQueueVatDeadlineIso(detail: WorkQueueDetail): string | null {
  if (detail.vatDeadline === undefined || detail.vatDeadline.trim() === '') return null
  return detail.vatDeadline
}

export function homeQueueVatBody(
  detail: WorkQueueDetail,
  deadlineLabel: string | null,
  t: Translate,
): string {
  if (deadlineLabel === null) return ''
  if (detail.vatPayable !== undefined && detail.vatPayable !== null) {
    const payable = BigInt(detail.vatPayable)
    if (payable < 0n) {
      return t('queue.vatFilingBodyRefund', {
        deadline: deadlineLabel,
        amount: formatMinorUnits(-payable),
      })
    }
    if (payable > 0n) {
      return t('queue.vatFilingBodyPayable', {
        deadline: deadlineLabel,
        amount: formatMinorUnits(payable),
      })
    }
  }
  return t('queue.vatFilingBody', { deadline: deadlineLabel })
}
