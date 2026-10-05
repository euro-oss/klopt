import type { MoneybirdAdministration } from '../ports/moneybird.js'
import { readNumber, readString, requireId } from './read.js'

/**
 * Month 1–12 from a Moneybird administration row.
 *
 * Moneybird's real field is `period_start_date` (e.g. `"2026-01-01"`). Older
 * or invented names stay as fallbacks. `null` when nothing readable — the
 * planner warns rather than silently assuming January.
 */
export function fiscalYearStartMonthOf(row: Record<string, unknown>): number | null {
  const dated =
    readString(row, 'period_start_date') ??
    readString(row, 'fiscal_year_start') ??
    readString(row, 'financial_year_start') ??
    readString(row, 'start_date')
  if (dated !== null) {
    const match =
      /^\d{4}-(\d{1,2})-\d{1,2}$/.exec(dated) ?? /(?:\d{4}-)?(\d{1,2})-\d{1,2}/.exec(dated)
    if (match?.[1] !== undefined) {
      const month = Number(match[1])
      if (month >= 1 && month <= 12) return month
    }
  }

  const numeric =
    readNumber(row, 'fiscal_year_start_month') ?? readNumber(row, 'financial_year_start_month')
  if (numeric !== null && numeric >= 1 && numeric <= 12) return Math.trunc(numeric)

  return null
}

/**
 * Choosing which Moneybird administration to import.
 *
 * One personal API token reaches every administration the user belongs to.
 * Importing the wrong one is the same hazard as Exact's division picker, so
 * the id is stored on the connection rather than passed on every request.
 */

export interface SelectableAdministration extends MoneybirdAdministration {
  readonly label: string
}

export function parseAdministration(row: Record<string, unknown>): MoneybirdAdministration {
  return {
    id: requireId(row, 'id'),
    name: readString(row, 'name') ?? requireId(row, 'id'),
    language: readString(row, 'language'),
    currency: readString(row, 'currency'),
    country: readString(row, 'country'),
    timeZone: readString(row, 'time_zone'),
    fiscalYearStartMonth: fiscalYearStartMonthOf(row),
  }
}

export function describeAdministration(
  administration: MoneybirdAdministration,
): SelectableAdministration {
  const bits = [administration.name, `(${administration.id})`]
  if (administration.currency !== null) bits.push(administration.currency)
  if (administration.country !== null) bits.push(administration.country)
  return { ...administration, label: bits.join(' ') }
}

export function selectableAdministrations(
  administrations: readonly MoneybirdAdministration[],
): readonly SelectableAdministration[] {
  return [...administrations]
    .map(describeAdministration)
    .sort((a, b) => a.name.localeCompare(b.name, 'nl') || a.id.localeCompare(b.id))
}

export function findAdministration(
  administrations: readonly MoneybirdAdministration[],
  id: string,
): SelectableAdministration | null {
  const found = administrations.find((administration) => administration.id === id)
  return found === undefined ? null : describeAdministration(found)
}
