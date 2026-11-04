import { describe, expect, it } from 'vitest'
import { planFiscalYear, priorFiscalYearCodeToOpen } from '@klopt/core'
import {
  currentFiscalYear,
  dayAfter,
  fiscalYearSearch,
  earlierUnclosedBookYearCodes,
  formatBookYearCodeList,
  hasYearAfter,
  isFiscalYearCode,
  isOfferedFiscalYearToOpen,
  isYearScopedRoute,
  nextFiscalYear,
  offeredFiscalYearCodesToOpen,
  plannedFiscalYear,
  resolveFiscalYear,
  sanitizeBookYearOpenSearch,
  startingMonth,
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

describe('the year in the address', () => {
  it('takes the number a link carries', () => {
    expect(fiscalYearSearch({ fiscalYear: 2025 })).toEqual({ fiscalYear: 2025 })
  })

  it('takes one somebody typed as text, which is what a pasted URL is', () => {
    expect(fiscalYearSearch({ fiscalYear: '2025' })).toEqual({ fiscalYear: 2025 })
  })

  it('drops anything that is not a book year label', () => {
    // Rather than passing it to a report, which would answer with an empty
    // year nobody asked for.
    expect(fiscalYearSearch({ fiscalYear: 'vorig jaar' })).toEqual({})
    expect(fiscalYearSearch({ fiscalYear: 25 })).toEqual({})
    expect(fiscalYearSearch({})).toEqual({})
  })

  it('knows which screens read it', () => {
    // The shell writes the year into the address only where a screen takes it
    // out again: a URL carrying state nothing honours is a lie that survives
    // being copied.
    expect(isYearScopedRoute('/reports/trial-balance')).toBe(true)
    expect(isYearScopedRoute('/')).toBe(true)
    expect(isYearScopedRoute('/settings')).toBe(false)
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

describe('the next book year', () => {
  it('is labelled by the year after the latest one, and keeps its months', () => {
    // A July–June administration's 2026 is followed by 2027, running July 2027
    // to June 2028. Labelling the next one 2027 and dating it from January
    // would be two different years wearing one label.
    expect(nextFiscalYear([broken('2025'), broken('2026')])).toEqual({
      code: '2027',
      startsOn: '2027-07-01',
      endsOn: '2028-06-30',
      status: 'open',
    })

    expect(nextFiscalYear([calendar('2026')])).toEqual({
      code: '2027',
      startsOn: '2027-01-01',
      endsOn: '2027-12-31',
      status: 'open',
    })
  })

  it('follows the latest year rather than the last one listed', () => {
    expect(nextFiscalYear([broken('2026'), broken('2024'), broken('2025')])?.code).toBe('2027')
  })

  it('is nothing at all when there are no years to follow', () => {
    // No starting month to read, so there is nothing honest to show. The form
    // offers no label rather than guessing January.
    expect(nextFiscalYear([])).toBeNull()
  })

  it('offers nothing beyond the configured book-year ceiling', () => {
    expect(nextFiscalYear([calendar('2100')])).toBeNull()
  })

  /**
   * The dates the screen shows read-only are the dates the server will create.
   *
   * `POST /fiscal-years` takes a label and derives the rest through
   * `planFiscalYear`, which lives in a package built around `node:crypto` and
   * cannot reach a browser — so the arithmetic is written out twice. This is
   * what stops the copy drifting: the same questions, asked of both.
   */
  it('agrees with planFiscalYear, month by month', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const code of ['2024', '2025', '2026', '2027', '2100']) {
        const planned = planFiscalYear(code, month)
        expect(plannedFiscalYear(code, month)).toEqual({
          code,
          startsOn: planned.startsOn,
          endsOn: planned.endsOn,
        })
      }
    }
  })

  it('reads the starting month off the year itself', () => {
    expect(startingMonth(broken('2026'))).toBe(7)
    expect(startingMonth(calendar('2026'))).toBe(1)
  })
})

describe('whether a close has anywhere to carry balances to', () => {
  it('is a period containing the day after the year ends', () => {
    // The condition `POST /fiscal-years/close` checks before it posts anything.
    // Answering it here is what lets the screen offer the missing year instead
    // of only repeating the refusal.
    const years = [calendar('2025'), calendar('2026')]
    expect(hasYearAfter(years, calendar('2025'))).toBe(true)
    expect(hasYearAfter(years, calendar('2026'))).toBe(false)
  })

  it('does not assume the next year starts in January', () => {
    const years = [broken('2025'), broken('2026')]
    expect(dayAfter(broken('2025').endsOn)).toBe('2026-07-01')
    expect(hasYearAfter(years, broken('2025'))).toBe(true)
    expect(hasYearAfter(years, broken('2026'))).toBe(false)
  })

  it('steps over a month end and a leap day', () => {
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
    expect(dayAfter('2024-02-28')).toBe('2024-02-29')
  })
})

describe('earlier unclosed book years on Boekjaren', () => {
  it('lists every prior open year, oldest first', () => {
    const years = [calendar('2024'), calendar('2025'), { ...calendar('2026'), status: 'open' }]
    expect(earlierUnclosedBookYearCodes(years, calendar('2026'))).toEqual(['2024', '2025'])
    expect(earlierUnclosedBookYearCodes(years, calendar('2025'))).toEqual(['2024'])
    expect(earlierUnclosedBookYearCodes(years, calendar('2024'))).toEqual([])
  })

  it('ignores closed prior years', () => {
    const years = [{ ...calendar('2025'), status: 'closed' }, calendar('2026')]
    expect(earlierUnclosedBookYearCodes(years, calendar('2026'))).toEqual([])
  })

  it('shows no hint once every earlier year is closed', () => {
    const years = [
      { ...calendar('2024'), status: 'closed' },
      { ...calendar('2025'), status: 'closed' },
      calendar('2026'),
    ]
    expect(earlierUnclosedBookYearCodes(years, calendar('2026'))).toEqual([])
  })

  it('formats year lists for Dutch copy', () => {
    expect(formatBookYearCodeList(['2025'], 'nl')).toBe('2025')
    expect(formatBookYearCodeList(['2024', '2025'], 'nl')).toBe('2024 en 2025')
    expect(formatBookYearCodeList(['2023', '2024', '2025'], 'nl')).toBe('2023, 2024 en 2025')
    expect(formatBookYearCodeList(['2023', '2024', '2025'], 'en')).toBe('2023, 2024 and 2025')
  })
})

describe('opening the prior book year from Boekjaren', () => {
  it('offers no year below the 1960 floor', () => {
    expect(priorFiscalYearCodeToOpen('1960')).toBeNull()
    expect(priorFiscalYearCodeToOpen('1961')).toBe('1960')
  })
})

describe('book years offered to open from Boekjaren or a form link', () => {
  it('names prior and next labels only', () => {
    expect(offeredFiscalYearCodesToOpen([calendar('2026')])).toEqual({
      prior: '2025',
      next: '2027',
    })
    expect(offeredFiscalYearCodesToOpen([calendar('2024'), calendar('2026')])).toEqual({
      prior: null,
      next: '2027',
    })
  })

  it('treats only those two labels as openable', () => {
    const years = [calendar('2024'), calendar('2026')]
    expect(isOfferedFiscalYearToOpen(years, '2025')).toBe(false)
    expect(isOfferedFiscalYearToOpen(years, '2023')).toBe(false)
    expect(isOfferedFiscalYearToOpen(years, '2027')).toBe(true)
  })

  it('drops a gap-year openYear from deep links', () => {
    const years = [calendar('2026')]
    expect(
      sanitizeBookYearOpenSearch(years, { openYear: '2030', focus: 'confirm', returnTo: '/x' }),
    ).toEqual({ returnTo: '/x' })
    expect(
      sanitizeBookYearOpenSearch(years, { openYear: '2025', focus: 'confirm', returnTo: '/x' }),
    ).toEqual({ openYear: '2025', focus: 'confirm', returnTo: '/x' })
  })
})
