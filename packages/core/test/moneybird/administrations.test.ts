import { describe, expect, it } from 'vitest'
import { findAdministration, parseAdministration, selectableAdministrations } from '../../src/index.js'

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
})
