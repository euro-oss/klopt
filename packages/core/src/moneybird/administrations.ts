import type { MoneybirdAdministration } from '../ports/moneybird.js'
import { readString, requireId } from './read.js'

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
