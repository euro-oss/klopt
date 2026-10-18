import { describe, expect, it } from 'vitest'
import {
  ECB_MAX_LOOKBACK_DAYS,
  applyFxToLines,
  calendarDaysBetween,
  convertMinorWithRate,
  formatExchangeRateSource,
  formatFxRateForDisplay,
  isOlderThanDays,
  isValidFxRate,
  lookupEcbRate,
  normalizeFxRateInput,
  parseExchangeRateSource,
  previewFxConversion,
  type JournalLineInput,
} from '../../src/index.js'

const blankLine = {
  currency: null,
  exchangeRate: null,
  exchangeRateSource: null,
  taxCode: null,
  taxRole: null,
  taxAmount: null,
  dimensions: [],
  subledgerKind: null,
  subledgerId: null,
} as const

function line(debit: bigint, credit: bigint): JournalLineInput {
  return {
    ...blankLine,
    accountNumber: '8000',
    description: 'Omzet',
    debit,
    credit,
  }
}

describe('ECB rate lookup', () => {
  const rates = [
    { currency: 'USD', rateDate: '2026-10-14', rate: '0.9200' },
    { currency: 'USD', rateDate: '2026-10-16', rate: '0.9214' },
    { currency: 'GBP', rateDate: '2026-10-16', rate: '1.1600' },
    { currency: 'USD', rateDate: '2026-01-01', rate: '0.9000' },
  ]

  it('picks the rate on the document date', () => {
    expect(lookupEcbRate(rates, 'USD', '2026-10-16')).toEqual({
      rate: '0.9214',
      source: 'ecb',
      date: '2026-10-16',
    })
  })

  it('walks back to the nearest earlier business day within 7 days', () => {
    expect(lookupEcbRate(rates, 'USD', '2026-10-15')).toEqual({
      rate: '0.9200',
      source: 'ecb',
      date: '2026-10-14',
    })
  })

  it('refuses a stale rate older than the lookback window', () => {
    expect(lookupEcbRate(rates, 'USD', '2026-10-10')).toBeNull()
    expect(calendarDaysBetween('2026-01-01', '2026-10-16')).toBeGreaterThan(ECB_MAX_LOOKBACK_DAYS)
    expect(lookupEcbRate(rates, 'USD', '2026-10-16')).not.toBeNull()
  })

  it('returns null when nothing is on or before the date', () => {
    expect(lookupEcbRate(rates, 'USD', '2025-01-01')).toBeNull()
  })

  it('flags documents older than 90 days for the full ECB history feed', () => {
    expect(isOlderThanDays('2026-01-01', 90, '2026-10-16')).toBe(true)
    expect(isOlderThanDays('2026-10-01', 90, '2026-10-16')).toBe(false)
  })
})

describe('exchangeRateSource packing', () => {
  it('stores source and date in exchangeRateSource', () => {
    expect(formatExchangeRateSource({ rate: '0.9214', source: 'ecb', date: '2026-10-16' })).toBe(
      'ecb:2026-10-16',
    )
    expect(
      formatExchangeRateSource({ rate: '0.9000', source: 'override', date: '2026-10-16' }),
    ).toBe('override:2026-10-16')
  })

  it('parses the stored form back', () => {
    expect(parseExchangeRateSource('ecb:2026-10-16')).toMatchObject({
      source: 'ecb',
      date: '2026-10-16',
    })
    expect(parseExchangeRateSource('override:2026-10-16')?.source).toBe('override')
    expect(parseExchangeRateSource('ECB 2026-10-16')).toBeNull()
  })
})

describe('applying FX to planned lines', () => {
  it('writes rate and packed source onto every line', () => {
    const lines = applyFxToLines([line(0n, 125000n)], 'USD', {
      rate: '0.9214',
      source: 'ecb',
      date: '2026-10-16',
    })
    expect(lines[0]).toMatchObject({
      currency: 'USD',
      exchangeRate: '0.9214',
      exchangeRateSource: 'ecb:2026-10-16',
      credit: 125000n,
    })
  })

  it('converts for the Koers preview', () => {
    expect(convertMinorWithRate(125000n, '0.9214')).toBe(115175n)
    expect(previewFxConversion([{ label: 'Omzet', amountMinor: 125000n }], '0.9214')[0]).toEqual({
      label: 'Omzet',
      foreignMinor: 125000n,
      functionalMinor: 115175n,
    })
  })

  it('rejects a non-positive rate', () => {
    expect(isValidFxRate('0')).toBe(false)
    expect(isValidFxRate('-1')).toBe(false)
    expect(isValidFxRate('0.9214')).toBe(true)
  })

  it('caps fractional digits at the ledger numeric(24,12) precision', () => {
    expect(isValidFxRate('0.123456789012')).toBe(true)
    expect(isValidFxRate('0.1234567890123')).toBe(false)
    expect(normalizeFxRateInput('0,1234567890123')).toBeNull()
  })

  it('accepts NL comma decimals and rejects invalid overrides', () => {
    expect(normalizeFxRateInput('0,9214')).toBe('0.9214')
    expect(normalizeFxRateInput(' 0.9214 ')).toBe('0.9214')
    expect(normalizeFxRateInput('0')).toBeNull()
    expect(normalizeFxRateInput('-1,2')).toBeNull()
    expect(normalizeFxRateInput('abc')).toBeNull()
  })

  it('formats rates for NL display with a comma', () => {
    expect(formatFxRateForDisplay('0.9214')).toBe('0,9214')
    expect(formatFxRateForDisplay('1')).toBe('1')
  })
})
