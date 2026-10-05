import { describe, expect, it } from 'vitest'
import {
  findAdministration,
  fiscalYearStartMonthOf,
  parseAdministration,
  selectableAdministrations,
} from '../../src/index.js'

describe('choosing a Moneybird administration', () => {
  const rows = [
    parseAdministration({ id: 2, name: 'Voorbeeld BV', currency: 'EUR', country: 'NL' }),
    parseAdministration({ id: 1, name: 'Oefenadministratie', currency: 'EUR', country: 'NL' }),
  ]

  it('sorts by name so the ordinary one is not lost in the list', () => {
    expect(selectableAdministrations(rows).map((row) => row.id)).toEqual(['1', '2'])
  })

  it('refuses an id the token cannot reach', () => {
    expect(findAdministration(rows, '9')).toBeNull()
    expect(findAdministration(rows, '2')?.name).toBe('Voorbeeld BV')
  })

  it('reads the fiscal year start month, and defaults to January', () => {
    expect(fiscalYearStartMonthOf({})).toBe(1)
    expect(fiscalYearStartMonthOf({ fiscal_year_start_month: 4 })).toBe(4)
    expect(fiscalYearStartMonthOf({ financial_year_start: '2026-07-01' })).toBe(7)
    expect(
      parseAdministration({ id: 3, name: 'April BV', fiscal_year_start_month: 4 }),
    ).toMatchObject({ fiscalYearStartMonth: 4 })
  })
})
