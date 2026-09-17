import { describe, expect, it } from 'vitest'
import { MoneyFormatError, fromWire, minorUnitExponent, money, toWire } from '../src/money.js'

describe('money wire format', () => {
  it('renders minor units as a decimal string', () => {
    expect(toWire(money(123456n, 'EUR'))).toEqual({ amount: '1234.56', currency: 'EUR' })
    expect(toWire(money(5n, 'EUR'))).toEqual({ amount: '0.05', currency: 'EUR' })
    expect(toWire(money(0n, 'EUR'))).toEqual({ amount: '0.00', currency: 'EUR' })
  })

  it('keeps the sign on the whole amount, not the fraction', () => {
    expect(toWire(money(-5n, 'EUR'))).toEqual({ amount: '-0.05', currency: 'EUR' })
    expect(toWire(money(-123456n, 'EUR'))).toEqual({ amount: '-1234.56', currency: 'EUR' })
  })

  it('respects currencies that are not two-decimal', () => {
    expect(minorUnitExponent('JPY')).toBe(0)
    expect(toWire(money(1234n, 'JPY'))).toEqual({ amount: '1234', currency: 'JPY' })
    expect(toWire(money(1234n, 'KWD'))).toEqual({ amount: '1.234', currency: 'KWD' })
  })

  it('round-trips exactly, including amounts no float can hold', () => {
    const cases = [0n, 1n, -1n, 99n, 100n, 12345678901234567890n, -12345678901234567890n]
    for (const minorUnits of cases) {
      const original = money(minorUnits, 'EUR')
      expect(fromWire(toWire(original))).toEqual(original)
    }
  })

  it('accepts shorthand decimals', () => {
    expect(fromWire({ amount: '10', currency: 'EUR' }).minorUnits).toBe(1000n)
    expect(fromWire({ amount: '10.5', currency: 'EUR' }).minorUnits).toBe(1050n)
  })

  it('refuses to round excess precision away', () => {
    // Rounding here would be a rounding difference with no destination account.
    expect(() => fromWire({ amount: '1.005', currency: 'EUR' })).toThrow(MoneyFormatError)
    expect(() => fromWire({ amount: '1.5', currency: 'JPY' })).toThrow(MoneyFormatError)
  })

  it('rejects anything that is not a plain decimal', () => {
    for (const amount of ['', '1,00', '1e3', 'NaN', 'Infinity', '1.', '.5', ' 1.00 ']) {
      expect(() => fromWire({ amount, currency: 'EUR' })).toThrow(MoneyFormatError)
    }
  })
})
