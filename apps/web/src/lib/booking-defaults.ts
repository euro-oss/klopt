/**
 * Default booking dates on a few screens — pinned by unit tests (#121).
 */

import { calendarYearInAmsterdam, todayInAmsterdam } from './amsterdam-date'
import { localTodayIso } from './local-clock'

export function defaultManualEntryBookingDate(): string {
  return todayInAmsterdam()
}

export function defaultCreditNoteIssueDate(): string {
  return localTodayIso()
}

export function defaultImporterenWizardYear(
  selectedYear: string | undefined,
  reportYearCode: string | undefined,
): string {
  return selectedYear ?? reportYearCode ?? String(calendarYearInAmsterdam())
}
