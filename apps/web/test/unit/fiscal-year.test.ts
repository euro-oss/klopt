import { describe, expect, it } from 'vitest'
import {
  currentFiscalYear,
  isFiscalYearCode,
  resolveFiscalYear,
  withinFiscalYear,
  type FiscalYearOption,
} from '../../src/lib/fiscal-year.js'

/**
 * Which book year a screen shows.
 *
 * The bug this replaces: every report called `new Date().getFullYear()`. For
 * an administration whose boekjaar runs July to June — which setup offers, in
 * as many words — that is the wrong year for half the year, shown without a
 * control to correct it and without saying which year it meant.
 *
 * So the cases below are mostly the broken-year ones. A calendar year working
 * is not evidence of anything; it was working before.
 */

const calendar = (code: string): FiscalYearOption => ({
  code,
  startsOn: `${code}-01-01`,
  endsOn: `${code}-12-31`,
  status: 'open',
})

/** July to June, labelled by the year it opens in. */
const broken = (code: string): FiscalYearOption => ({
  code,
  startsOn: `${code}-07-01`,
  endsOn: `${String(Number(code) + 1)}-06-30`,
  status: 'open',
})

describe('the current book year', () => {
  it('is the one today falls in', () => {
    const years = [calendar('2024'), calendar('2025'), calendar('2026')]
    expect(currentFiscalYear(years, '2025-03-04')?.code).toBe('2025')
  })

  it('is 2025 in March 2026 when the year runs July to June', () => {
    // The whole point. The calendar says 2026 and the books are in 2025.
    const years = [broken('2024'), broken('2025'), broken('2026')]
    expect(currentFiscalYear(years, '2026-03-04')?.code).toBe('2025')
  })

  it('falls back to the most recent year that has started', () => {
    // An administration whose years stop in 2024 should show 2024, not an
    // empty report for a year nobody opened.
    const years = [calendar('2023'), calendar('2024')]
    expect(currentFiscalYear(years, '2026-03-04')?.code).toBe('2024')
  })

  it('offers the earliest year to somebody who is early', () => {
    const years = [calendar('2027')]
    expect(currentFiscalYear(years, '2026-03-04')?.code).toBe('2027')
  })

  it('has no answer for an administration with no book years', () => {
    expect(currentFiscalYear([], '2026-03-04')).toBeNull()
  })
})

describe('the year a screen reads', () => {
  const years = [broken('2024'), broken('2025'), broken('2026')]

  it('is the one that was asked for', () => {
    expect(resolveFiscalYear(years, '2024', '2026-03-04')?.code).toBe('2024')
  })

  it('ignores a remembered year this administration does not have', () => {
    // A cookie set in another administration must not be able to make every
    // figure on every screen zero.
    expect(resolveFiscalYear(years, '2019', '2026-03-04')?.code).toBe('2025')
  })

  it('reads a running year as of today', () => {
    expect(resolveFiscalYear(years, null, '2026-03-04')).toMatchObject({
      code: '2025',
      isCurrent: true,
      asOf: '2026-03-04',
    })
  })

  it('reads a finished year as of its last day', () => {
    // Ageing a closed year as of today would report every invoice in it as a
    // year late, which is a report nobody can act on.
    expect(resolveFiscalYear(years, '2024', '2026-03-04')).toMatchObject({
      isCurrent: false,
      asOf: '2025-06-30',
    })
  })

  it('reads a year that has not started as of its first day', () => {
    expect(resolveFiscalYear(years, '2026', '2026-03-04')).toMatchObject({
      isCurrent: false,
      asOf: '2026-07-01',
    })
  })

  it('has no answer without book years, rather than inventing one', () => {
    expect(resolveFiscalYear([], '2026', '2026-03-04')).toBeNull()
  })
})

describe('what belongs to the year on screen', () => {
  const scope = resolveFiscalYear([broken('2025')], null, '2026-03-04')!

  it('takes a date inside it', () => {
    expect(withinFiscalYear(scope, '2025-07-01')).toBe(true)
    expect(withinFiscalYear(scope, '2026-06-30')).toBe(true)
  })

  it('leaves out the day before and the day after', () => {
    expect(withinFiscalYear(scope, '2025-06-30')).toBe(false)
    expect(withinFiscalYear(scope, '2026-07-01')).toBe(false)
  })

  it('reads a timestamp as the day it happened', () => {
    // The postvak dates its arrivals to the second; everything else in the
    // queue is a plain date.
    expect(withinFiscalYear(scope, '2025-12-24T23:14:02.113Z')).toBe(true)
  })

  it('treats a missing date as not in the year', () => {
    expect(withinFiscalYear(scope, null)).toBe(false)
  })
})

describe('what counts as a book year label', () => {
  it('is four digits and nothing else', () => {
    expect(isFiscalYearCode('2026')).toBe(true)
    expect(isFiscalYearCode('26')).toBe(false)
    expect(isFiscalYearCode('2026-2027')).toBe(false)
    expect(isFiscalYearCode(null)).toBe(false)
  })
})
