import { describe, expect, it } from 'vitest'
import {
  findDivision,
  parseDivision,
  parseMe,
  selectableDivisions,
  type ExactDivision,
} from '../../src/index.js'

/**
 * Choosing which administration to import.
 *
 * The user this was built for has test and production administrations under one
 * login, which is the ordinary case rather than an edge one. Getting this
 * choice wrong puts fictional invoices into books that get filed, so the
 * cautions are the feature and the sort order is the smaller half of it.
 */

const division = (overrides: Partial<ExactDivision> = {}): ExactDivision => ({
  code: 1000,
  description: 'Voorbeeld BV',
  currency: 'EUR',
  country: 'NL',
  vatNumber: 'NL123456789B01',
  chamberOfCommerceNumber: '12345678',
  status: 1,
  isMainDivision: true,
  isPracticeDivision: false,
  isDossierDivision: false,
  archiveDate: null,
  current: false,
  ...overrides,
})

describe('cautions', () => {
  it('says nothing about an ordinary active division', () => {
    const [only] = selectableDivisions([division()])
    expect(only?.cautions).toEqual([])
    expect(only?.ordinary).toBe(true)
    expect(only?.label).toBe('Voorbeeld BV (1000)')
  })

  it('flags a practice division, which is the one nobody means to import', () => {
    const [only] = selectableDivisions([division({ isPracticeDivision: true })])
    expect(only?.cautions).toEqual(['practice'])
    expect(only?.label).toContain('oefenadministratie')
  })

  it('flags an archived division from its status', () => {
    const [only] = selectableDivisions([division({ status: 2 })])
    expect(only?.cautions).toEqual(['archived'])
  })

  it('flags an archived division from its archive date, whatever the status says', () => {
    // A division can carry an archive date while `Status` still reads active.
    const [only] = selectableDivisions([division({ status: 1, archiveDate: '2024-12-31' })])
    expect(only?.cautions).toEqual(['archived'])
  })

  it('does not call an archived division inactive as well', () => {
    const [only] = selectableDivisions([division({ status: 2, archiveDate: '2024-12-31' })])
    expect(only?.cautions).toEqual(['archived'])
  })

  it('flags an inactive division', () => {
    const [only] = selectableDivisions([division({ status: 0 })])
    expect(only?.cautions).toEqual(['inactive'])
  })

  it('reports every caution a division has', () => {
    const [only] = selectableDivisions([
      division({ isPracticeDivision: true, isDossierDivision: true, status: 2 }),
    ])
    expect(only?.cautions).toEqual(['practice', 'dossier', 'archived'])
  })
})

describe('the order they are offered in', () => {
  it('puts ordinary divisions before anything with a caution', () => {
    const chosen = selectableDivisions([
      division({ code: 1, description: 'Aardig Testje', isPracticeDivision: true }),
      division({ code: 2, description: 'Zebra Holding BV' }),
    ])

    // Alphabetically the test division comes first. It must not be at the top
    // of a list somebody is about to click through.
    expect(chosen.map((entry) => entry.code)).toEqual([2, 1])
  })

  it('does not float the current division to the top', () => {
    // `Current` is whichever division Exact was last pointed at — a fact about
    // somebody's browsing, not about which books they want to migrate.
    const chosen = selectableDivisions([
      division({ code: 1, description: 'Alfa BV' }),
      division({ code: 2, description: 'Beta BV', current: true }),
    ])
    expect(chosen[0]?.code).toBe(1)
  })

  it('breaks a name tie on the code, so the order is stable', () => {
    const chosen = selectableDivisions([
      division({ code: 20, description: 'Zelfde BV' }),
      division({ code: 10, description: 'Zelfde BV' }),
    ])
    expect(chosen.map((entry) => entry.code)).toEqual([10, 20])
  })
})

describe('finding one by code', () => {
  const divisions = [division({ code: 1000 }), division({ code: 2000 })]

  it('finds a division the connection can reach', () => {
    expect(findDivision(divisions, 2000)?.code).toBe(2000)
  })

  it('refuses a code the connection cannot reach', () => {
    // The code arrives in a request body. Trusting it would let somebody point
    // an import at a division their token has no rights to.
    expect(findDivision(divisions, 3000)).toBeNull()
  })
})

describe('parsing what Exact returns', () => {
  it('reads the columns system/Divisions is asked for', () => {
    const parsed = parseDivision({
      Code: 3196493,
      Description: 'Klopt Test BV',
      Currency: 'EUR',
      Country: 'NL',
      VATNumber: 'NL999999999B01',
      ChamberOfCommerceNumber: '87654321',
      Status: 1,
      IsMainDivision: false,
      IsPracticeDivision: true,
      IsDossierDivision: false,
      ArchiveDate: null,
      Current: true,
    })

    expect(parsed.code).toBe(3196493)
    expect(parsed.description).toBe('Klopt Test BV')
    expect(parsed.isPracticeDivision).toBe(true)
    expect(parsed.current).toBe(true)
  })

  it('falls back to the number when a division has no description', () => {
    const parsed = parseDivision({ Code: 1234 })
    expect(parsed.description).toBe('Administratie 1234')
  })

  it('reads the current division out of Me, which is where a connection starts', () => {
    const me = parseMe({
      UserID: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      FullName: 'H. Stokvis',
      CurrentDivision: 3196493,
      ServerTime: '2026-09-08T10:00:00',
    })

    expect(me.currentDivision).toBe(3196493)
    expect(me.userId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })
})
