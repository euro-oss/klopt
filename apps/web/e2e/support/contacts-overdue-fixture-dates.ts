import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { addCalendarDays } from '../../src/lib/amsterdam-date.js'

/** Calendar dates exercised in the fake-clock proof (same year as VAT defaults in e2e). */
export const CONTACTS_OVERDUE_CALENDAR_PROOF_DATES = [
  '2026-01-01',
  '2026-01-15',
  '2026-02-20',
  '2026-03-05',
  '2026-12-31',
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
 * Issue dates stay inside the current calendar fiscal year (1 Jan … asOf).
 * Due dates are relative to `asOf`; overdue means dueDate &lt; asOf (exclusive).
 *
 * On the first day of a book year there is no VAT-valid overdue *sales* invoice
 * entirely inside that year (issue and due both on 1 Jan is not overdue). Calendar
 * tests on that day still prove not-yet-due styling and supplier overdue via an
 * explicit purchase due date on the last day of the previous calendar year, with
 * the prior book year opened first (see spec).
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
    const target = addCalendarDays(asOf, -(OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS + 1))
    return target >= fiscalYearStart ? target : fiscalYearStart
  }

  function notYetDuePurchaseBill(): { readonly invoiceDate: string; readonly dueDate: string } {
    return {
      invoiceDate: issueDateDaysAgo(10),
      dueDate: dueDateDaysFromAsOf(90),
    }
  }

  function overduePurchaseBill(): { readonly invoiceDate: string; readonly dueDate: string } {
    if (asOf === fiscalYearStart) {
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

export async function installWallClock(page: Page, isoDate: string): Promise<void> {
  const instant = wallClockInstantForIsoDate(isoDate)
  await page.context().addCookies([
    {
      name: 'klopt-e2e-as-of',
      value: isoDate,
      domain: 'localhost',
      path: '/',
    },
  ])
  await page.setExtraHTTPHeaders({
    'X-Klopt-E2e-As-Of': isoDate,
  })
  await page.clock.install({ time: instant })
  await page.clock.setFixedTime(instant)
}

export async function ensurePriorFiscalYearOpen(page: Page, asOf: string): Promise<void> {
  const priorCode = String(Number(asOf.slice(0, 4)) - 1)
  const response = await page.request.post('/api/v1/fiscal-years', {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { code: priorCode },
  })
  expect(response.ok() || response.status() === 409, await response.text()).toBeTruthy()
}

export function customerNotYetDueIssueDate(dates: ContactsOverdueFixtureDates): string {
  return dates.asOf
}

export function contactsOverdueNeedsPriorFiscalYear(asOf: string): boolean {
  return asOf === `${asOf.slice(0, 4)}-01-01`
}
