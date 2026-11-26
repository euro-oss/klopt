/** XAF / VAT export metadata dates — pinned by unit tests (#121). */

import { todayInAmsterdam } from './amsterdam-date'

export function xafExportGeneratedOn(): string {
  return todayInAmsterdam()
}

export function vatExportGeneratedOn(): string {
  return todayInAmsterdam()
}
