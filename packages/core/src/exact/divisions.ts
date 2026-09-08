import type { ExactDivision } from '../ports/exact.js'
import { readBoolean, readDate, readGuid, readNumber, readString, requireNumber } from './read.js'

/**
 * Choosing which administration to import (spec 13).
 *
 * One Exact login reaches every division the user has rights to, and a real
 * account has more than one on purpose: the operating BV, the holding, a
 * practice division from a course, and the test division somebody made to try
 * something out before doing it for real. They all look the same in a dropdown.
 *
 * Importing the wrong one puts fictional invoices into books that get filed,
 * and the mistake is not obvious afterwards — the numbers are plausible,
 * because whoever made the test division made it plausible.
 *
 * So this module does not sort a list of names. It says, for each division,
 * what it is and whether importing it is likely to be what somebody meant, and
 * the confirmation on the way in quotes the division back rather than its
 * position in a list.
 */

/**
 * Why a division might not be the one you want.
 *
 * `practice` and `dossier` are Exact's own flags. `archived` and `inactive`
 * come from `Status`. None of them is a refusal — an accountant restoring an
 * archived year is a real thing to want — but each of them is something a
 * screen has to say out loud before the import runs.
 */
export type DivisionCaution = 'practice' | 'dossier' | 'archived' | 'inactive' | 'blocked'

export interface SelectableDivision extends ExactDivision {
  /** Everything about this division that a human should read before choosing. */
  readonly cautions: readonly DivisionCaution[]
  /** True when there is nothing to warn about. */
  readonly ordinary: boolean
  /**
   * What a screen shows: the description, then the number, then anything that
   * makes this division unusual. Built here rather than in the route so the
   * confirmation, the audit entry and the screen all say the same thing.
   */
  readonly label: string
}

const CAUTION_TEXT: Record<DivisionCaution, string> = {
  practice: 'oefenadministratie',
  dossier: 'dossieradministratie',
  archived: 'gearchiveerd',
  inactive: 'inactief',
  blocked: 'geblokkeerd',
}

/** Exact's `Status`: 0 inactive, 1 active, 2 archived. */
function cautionsFor(division: ExactDivision): DivisionCaution[] {
  const cautions: DivisionCaution[] = []
  if (division.isPracticeDivision) cautions.push('practice')
  if (division.isDossierDivision) cautions.push('dossier')
  if (division.status === 2 || division.archiveDate !== null) cautions.push('archived')
  else if (division.status === 0) cautions.push('inactive')
  return cautions
}

export function describeDivision(division: ExactDivision): SelectableDivision {
  const cautions = cautionsFor(division)
  const suffix =
    cautions.length === 0 ? '' : ` — ${cautions.map((c) => CAUTION_TEXT[c]).join(', ')}`

  return {
    ...division,
    cautions,
    ordinary: cautions.length === 0,
    label: `${division.description} (${String(division.code)})${suffix}`,
  }
}

/**
 * The list a chooser shows.
 *
 * Ordinary divisions first, then everything with a caution, each group by name.
 * Not by Exact's own order, which is by code and therefore by the accident of
 * when each division was created.
 *
 * The current division is *not* floated to the top. It is whichever one the API
 * happened to be pointed at, which for a fresh connection is the one Exact
 * calls most-recently-used — a fact about someone's browsing history, not about
 * which books they want to migrate.
 */
export function selectableDivisions(
  divisions: readonly ExactDivision[],
): readonly SelectableDivision[] {
  return divisions.map(describeDivision).sort((left, right) => {
    if (left.ordinary !== right.ordinary) return left.ordinary ? -1 : 1
    const byName = left.description.localeCompare(right.description, 'nl')
    return byName === 0 ? left.code - right.code : byName
  })
}

/**
 * Find a division by code, so that choosing one is checked against what Exact
 * actually offers rather than trusted from the request body.
 *
 * A code that is not in the list means the connection cannot reach it: either
 * the rights changed, or somebody typed a number. Both are a refusal.
 */
export function findDivision(
  divisions: readonly ExactDivision[],
  code: number,
): SelectableDivision | null {
  const found = divisions.find((division) => division.code === code)
  return found === undefined ? null : describeDivision(found)
}

/** The columns `system/Divisions` is asked for. Nothing else is read. */
export const DIVISION_SELECT = [
  'Code',
  'Description',
  'Currency',
  'Country',
  'VATNumber',
  'ChamberOfCommerceNumber',
  'Status',
  'IsMainDivision',
  'IsPracticeDivision',
  'IsDossierDivision',
  'ArchiveDate',
  'Current',
] as const

export function parseDivision(row: Record<string, unknown>): ExactDivision {
  return {
    code: requireNumber(row, 'Code'),
    // A division with no description is possible and useless to show, so it
    // falls back to its own number rather than to an empty line.
    description: readString(row, 'Description') ?? `Administratie ${String(row['Code'])}`,
    currency: readString(row, 'Currency'),
    country: readString(row, 'Country'),
    vatNumber: readString(row, 'VATNumber'),
    chamberOfCommerceNumber: readString(row, 'ChamberOfCommerceNumber'),
    status: readNumber(row, 'Status'),
    isMainDivision: readBoolean(row, 'IsMainDivision'),
    isPracticeDivision: readBoolean(row, 'IsPracticeDivision'),
    isDossierDivision: readBoolean(row, 'IsDossierDivision'),
    archiveDate: readDate(row, 'ArchiveDate'),
    current: readBoolean(row, 'Current'),
  }
}

/** `/api/v1/current/Me`, for the name on the connection and the starting division. */
export const ME_SELECT = ['UserID', 'FullName', 'CurrentDivision', 'ServerTime'] as const

export function parseMe(row: Record<string, unknown>): {
  readonly userId: string
  readonly fullName: string
  readonly currentDivision: number
  readonly serverTime: string | null
} {
  return {
    userId: readGuid(row, 'UserID') ?? '',
    fullName: readString(row, 'FullName') ?? 'onbekend',
    currentDivision: requireNumber(row, 'CurrentDivision'),
    serverTime: readString(row, 'ServerTime'),
  }
}
