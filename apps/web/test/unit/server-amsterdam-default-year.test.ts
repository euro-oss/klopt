import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityBody, listVatPeriodsQuery } from '../../src/api/schemas.js'
import { calendarYearStartInAmsterdam, todayInAmsterdam } from '../../src/lib/amsterdam-date.js'

/**
 * 2027-01-01 00:30 Amsterdam (CET) while UTC is still 2026-12-31 (#217).
 */
const NEW_YEAR_AMSTERDAM_MIDNIGHT = new Date('2026-12-31T23:30:00.000Z')

/** 2026-12-31 23:30 Amsterdam while UTC is still 2026-12-31 22:30. */
const OLD_YEAR_AMSTERDAM_EVE = new Date('2026-12-31T22:30:00.000Z')

describe('server default year from Amsterdam date (#217)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createEntityBody.firstFiscalYear', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('defaults to the new Amsterdam year just after local midnight on 1 January', () => {
      vi.setSystemTime(NEW_YEAR_AMSTERDAM_MIDNIGHT)
      expect(todayInAmsterdam()).toBe('2027-01-01')
      expect(createEntityBody.parse({ name: 'Nieuw Jaar BV' }).firstFiscalYear).toBe('2027')
    })

    it('defaults to the old Amsterdam year late on 31 December', () => {
      vi.setSystemTime(OLD_YEAR_AMSTERDAM_EVE)
      expect(todayInAmsterdam()).toBe('2026-12-31')
      expect(createEntityBody.parse({ name: 'Oud Jaar BV' }).firstFiscalYear).toBe('2026')
    })

    it('keeps an explicit firstFiscalYear', () => {
      vi.setSystemTime(NEW_YEAR_AMSTERDAM_MIDNIGHT)
      expect(createEntityBody.parse({ name: 'Vast BV', firstFiscalYear: '2020' }).firstFiscalYear).toBe(
        '2020',
      )
    })
  })

  describe('listVatPeriodsQuery.year', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('defaults to the new Amsterdam year just after local midnight on 1 January', () => {
      vi.setSystemTime(NEW_YEAR_AMSTERDAM_MIDNIGHT)
      expect(listVatPeriodsQuery.parse({}).year).toBe(2027)
    })

    it('defaults to the old Amsterdam year late on 31 December', () => {
      vi.setSystemTime(OLD_YEAR_AMSTERDAM_EVE)
      expect(listVatPeriodsQuery.parse({}).year).toBe(2026)
    })

    it('keeps an explicit year', () => {
      vi.setSystemTime(NEW_YEAR_AMSTERDAM_MIDNIGHT)
      expect(listVatPeriodsQuery.parse({ year: 2019 }).year).toBe(2019)
    })
  })

  describe('handleCreateTaxCodes calendarYearStartInAmsterdam fallback', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('uses the new Amsterdam year just after local midnight on 1 January', () => {
      vi.setSystemTime(NEW_YEAR_AMSTERDAM_MIDNIGHT)
      expect(calendarYearStartInAmsterdam()).toBe('2027-01-01')
    })

    it('uses the old Amsterdam year late on 31 December', () => {
      vi.setSystemTime(OLD_YEAR_AMSTERDAM_EVE)
      expect(calendarYearStartInAmsterdam()).toBe('2026-01-01')
    })
  })
})