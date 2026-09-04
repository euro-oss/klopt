import { describe, expect, it } from 'vitest'
import { formatMinorUnits, parseMinorUnits, formatDate } from '../../src/lib/format.js'

describe('formatting money', () => {
  it('renders Dutch grouping and decimals', () => {
    expect(formatMinorUnits(0n)).toBe('0,00')
    expect(formatMinorUnits(5n)).toBe('0,05')
    expect(formatMinorUnits(123_456n)).toBe('1.234,56')
    expect(formatMinorUnits(123_456_789_00n)).toBe('123.456.789,00')
  })

  it('renders negatives per the entity setting', () => {
    expect(formatMinorUnits(-123_456n)).toBe('-1.234,56')
    expect(formatMinorUnits(-123_456n, { negative: 'parentheses', showZero: true })).toBe(
      '(1.234,56)',
    )
  })

  it('can leave a zero blank, which is how a ledger column reads', () => {
    expect(formatMinorUnits(0n, { negative: 'minus', showZero: false })).toBe('')
  })

  it('survives amounts no float could hold', () => {
    expect(formatMinorUnits(9_223_372_036_854_775_807n)).toBe('92.233.720.368.547.758,07')
  })
})

describe('parsing what a bookkeeper types', () => {
  it('accepts both separators, because Dutch keyboards produce both', () => {
    expect(parseMinorUnits('1234,56')).toBe(123_456n)
    expect(parseMinorUnits('1.234,56')).toBe(123_456n)
    // A numeric keypad produces `.` and the user means a decimal point.
    expect(parseMinorUnits('1234.56')).toBe(123_456n)
    expect(parseMinorUnits('1234')).toBe(123_400n)
  })

  it('decides what a lone separator means by what follows it', () => {
    // Two trailing digits: decimals. Three: grouping. This is the whole rule.
    expect(parseMinorUnits('1.23')).toBe(123n)
    expect(parseMinorUnits('1.234')).toBe(123_400n)
    expect(parseMinorUnits('1,23')).toBe(123n)
    expect(parseMinorUnits('1,234')).toBe(123_400n)
  })

  it('reads repeated separators as grouping', () => {
    expect(parseMinorUnits('1.234.567')).toBe(123_456_700n)
    expect(parseMinorUnits('1.234.567,89')).toBe(123_456_789n)
  })

  it('takes the later separator as the decimal when both appear', () => {
    expect(parseMinorUnits('1.234,56')).toBe(123_456n)
    expect(parseMinorUnits('1,234.56')).toBe(123_456n)
  })

  it('accepts both ways of writing a negative', () => {
    expect(parseMinorUnits('-1234,56')).toBe(-123_456n)
    expect(parseMinorUnits('(1234,56)')).toBe(-123_456n)
  })

  it('ignores whitespace', () => {
    expect(parseMinorUnits('  1 234,56 ')).toBe(123_456n)
  })

  it('rejects what is not an amount', () => {
    for (const bad of ['', 'abc', '1.2.3.4,5', '1e3', '1.23.4', '12.3456', '--1']) {
      expect(parseMinorUnits(bad), bad).toBeNull()
    }
  })

  it('round-trips with the formatter', () => {
    for (const value of [0n, 1n, -1n, 99n, 100n, 123_456_789n, -123_456_789n]) {
      expect(parseMinorUnits(formatMinorUnits(value))).toBe(value)
    }
  })
})

describe('dates', () => {
  it('renders the way a Dutch invoice does', () => {
    expect(formatDate('2026-03-15')).toBe('15-03-2026')
  })
})
