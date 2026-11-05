import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { addCalendarDays } from '../../src/lib/amsterdam-date.js'
import { chooseOption, hydrated } from '../support.js'

/** Amsterdam/UTC midnight boundary exercised by `playwright.contacts-midnight.config.ts` (#121). */
export const CONTACTS_OVERDUE_MIDNIGHT_NOW_ISO = '2026-11-05T23:30:00.000Z'

/** Calendar dates exercised by `e2e/scripts/contacts-calendar-proof.sh`. */
export const CONTACTS_OVERDUE_CALENDAR_PROOF_DATES = [
  '2026-11-04',
  '2027-01-01',
  '2027-01-02',
  '2027-01-15',
  '2027-02-20',
  '2027-03-05',
  '2027-12-31',
] as const

export type ContactsOverdueFixtureDates = {
  readonly asOf: string
  readonly fiscalYearStart: string
  issueDateDaysAgo(daysAgo: number): string
  dueDateDaysFromAsOf(daysFromAsOf: number): string
  /** Issue date for an overdue customer invoice (uses {@link OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS}). */
  customerOverdueIssueDate(): string
  notYetDuePurchaseBill(): { readonly invoiceDate: string; readonly dueDate: string }
  overduePurchaseBill(): { readonly invoiceDate: string; readonly dueDate: string }
}

/** Short terms so an in-year issue date can be overdue before March. */
export const OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS = 1

/**
 * Shared invoice/bill dates for contacts open-overdue styling e2e.
 *
 * Issue dates stay inside the current calendar fiscal year (1 Jan … asOf) unless
 * the overdue case must sit in the prior book year (early January as-of).
 */
export function contactsOverdueFixtureDates(asOf: string): ContactsOverdueFixtureDates {
  const year = asOf.slice(0, 4)
  const fiscalYearStart = `${year}-01-01`

  function issueDateDaysAgo(daysAgo: number): string {
    const raw = addCalendarDays(asOf, -daysAgo)
    return raw < fiscalYearStart ? fiscalYearStart : raw
  }

  function dueDateDaysFromAsOf(daysFromAsOf: number): string {
    return addCalendarDays(asOf, daysFromAsOf)
  }

  function customerOverdueIssueDate(): string {
    if (asOf === fiscalYearStart) {
      const priorYear = String(Number(year) - 1)
      return `${priorYear}-11-01`
    }
    if (asOf === addCalendarDays(fiscalYearStart, 1)) {
      return fiscalYearStart
    }
    const target = addCalendarDays(asOf, -(OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS + 1))
    if (target >= fiscalYearStart) return target
    const priorYear = String(Number(year) - 1)
    return `${priorYear}-12-28`
  }

  function notYetDuePurchaseBill(): { readonly invoiceDate: string; readonly dueDate: string } {
    return {
      invoiceDate: issueDateDaysAgo(10),
      dueDate: dueDateDaysFromAsOf(90),
    }
  }

  function overduePurchaseBill(): { readonly invoiceDate: string; readonly dueDate: string } {
    if (asOf <= addCalendarDays(fiscalYearStart, 1)) {
      const priorYear = String(Number(year) - 1)
      return {
        invoiceDate: `${priorYear}-12-15`,
        dueDate: `${priorYear}-12-31`,
      }
    }
    const dueDate = addCalendarDays(asOf, -1)
    let invoiceDate = issueDateDaysAgo(14)
    if (invoiceDate > dueDate) invoiceDate = addCalendarDays(dueDate, -7)
    return { invoiceDate, dueDate }
  }

  return {
    asOf,
    fiscalYearStart,
    issueDateDaysAgo,
    dueDateDaysFromAsOf,
    customerOverdueIssueDate,
    notYetDuePurchaseBill,
    overduePurchaseBill,
  }
}

/** Wall-clock noon on `isoDate` in the browser timezone (use Europe/Amsterdam in the spec). */
export function wallClockInstantForIsoDate(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (match === null) throw new Error(`Expected YYYY-MM-DD, got ${isoDate}`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

/** Align the browser clock with the server’s fixed `KLOPT_E2E_TODAY_ISO` (calendar proof only). */
export async function installWallClock(page: Page, isoDate: string): Promise<void> {
  const instant = wallClockInstantForIsoDate(isoDate)
  await page.clock.install({ time: instant })
  await page.clock.setFixedTime(instant)
}

/** Pin Playwright’s clock to an exact instant (midnight-boundary regression). */
export async function installBrowserClockAtInstant(page: Page, instant: Date): Promise<void> {
  await page.clock.install({ time: instant })
  await page.clock.setFixedTime(instant)
}

export async function ensureFiscalYearOpen(page: Page, code: string): Promise<void> {
  const response = await page.request.post('/api/v1/fiscal-years', {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { code },
  })
  expect(response.ok() || response.status() === 409, await response.text()).toBeTruthy()
}

/**
 * Open the prior and current calendar book years via `POST /api/v1/fiscal-years`
 * (domain accepts any 4-digit code — see `packages/db` setup repository) and
 * select the year matching `asOf`.
 */
export async function ensureContactsFixtureFiscalYears(page: Page, asOf: string): Promise<void> {
  const year = asOf.slice(0, 4)
  const prior = String(Number(year) - 1)
  await ensureFiscalYearOpen(page, prior)
  await ensureFiscalYearOpen(page, year)
  await page.goto('/')
  await hydrated(page)
  await chooseOption(page, 'Boekjaar', new RegExp(`^${year}`))
}

export function customerNotYetDueIssueDate(dates: ContactsOverdueFixtureDates): string {
  return dates.asOf
}

/** Overdue sales or purchase legs that book in the prior book year need that year selected. */
export function contactsOverdueBooksInPriorFiscalYear(dates: ContactsOverdueFixtureDates): boolean {
  return (
    dates.customerOverdueIssueDate() < dates.fiscalYearStart ||
    dates.overduePurchaseBill().dueDate < dates.fiscalYearStart
  )
}
