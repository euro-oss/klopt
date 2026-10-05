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

  it('reads the fiscal year start from period_start_date', () => {
    expect(fiscalYearStartMonthOf({})).toBeNull()
    expect(fiscalYearStartMonthOf({ period_start_date: '2026-01-01' })).toBe(1)
    expect(fiscalYearStartMonthOf({ period_start_date: '2026-04-01' })).toBe(4)
    expect(fiscalYearStartMonthOf({ fiscal_year_start_month: 7 })).toBe(7)
    expect(
      parseAdministration({ id: 3, name: 'April BV', period_start_date: '2026-04-01' }),
    ).toMatchObject({ fiscalYearStartMonth: 4 })
  })
})
