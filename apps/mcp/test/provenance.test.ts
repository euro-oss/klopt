import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMIT, MAX_LIMIT, money, summarise } from '../src/provenance.js'

/**
 * The two rules spec 10.3 calls mandatory, and the reason each one is here.
 */

describe('turning the API’s minor units into something an agent can quote', () => {
  /**
   * The API answers money as minor units in a string. A program that knows the
   * convention is fine; a model reading `"debit": "147425980"` next to
   * `"currency": "EUR"` says a hundred and forty-seven million euro, and the
   * real figure is €1.474.259,80. Nothing in the payload contradicts it.
   *
   * A hundredfold error that reads as plausible is the worst kind, so the
   * conversion happens once, at the boundary where numbers stop being data and
   * start being prose.
   */
  it('reads the real figure from a real administration', () => {
    expect(money('147425980')).toBe('1474259.80')
  })

  it('keeps the cents that make an amount an amount', () => {
    expect(money('1')).toBe('0.01')
    expect(money('99')).toBe('0.99')
    expect(money('100')).toBe('1.00')
    expect(money('0')).toBe('0.00')
  })

  it('handles a credit balance', () => {
    expect(money('-60500')).toBe('-605.00')
    expect(money('-1')).toBe('-0.01')
  })

  it('takes what the API actually sends', () => {
    // bigint from a repository, number from JSON, string from the wire.
    expect(money(147_425_980n)).toBe('1474259.80')
    expect(money(60_500)).toBe('605.00')
  })

  it('passes through anything it does not recognise rather than mangling it', () => {
    // A value this cannot read is one to show visibly, not to reformat into
    // something that looks correct. An already-decimal amount is the case that
    // matters: the Exact routes serialise that way, and double-converting
    // would divide by a hundred a second time.
    expect(money('1474259.80')).toBe('1474259.80')
    expect(money('n/a')).toBe('n/a')
    expect(money('')).toBe('')
  })
})

describe('not filling a context window with a ledger', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ i }))

  it('says nothing when nothing was cut', () => {
    const result = summarise(rows(5))
    expect(result.rows).toHaveLength(5)
    expect(result.truncated).toBeUndefined()
  })

  it('cuts to the default and says so', () => {
    // Silence here is the danger: an agent that does not know a debtors list
    // was cut will name the largest debtor from the first twenty-five rows.
    const result = summarise(rows(100))
    expect(result.rows).toHaveLength(DEFAULT_LIMIT)
    expect(result.truncated).toMatchObject({ shown: DEFAULT_LIMIT, totalCount: 100 })
    expect(result.truncated?.more).toContain('Ask again with limit')
  })

  it('will not be talked past its ceiling', () => {
    const result = summarise(rows(5000), 100_000)
    expect(result.rows).toHaveLength(MAX_LIMIT)
    expect(result.truncated?.more).toContain('Narrow the question')
  })

  it('refuses a nonsensical limit rather than returning nothing', () => {
    expect(summarise(rows(10), 0).rows).toHaveLength(1)
    expect(summarise(rows(10), -5).rows).toHaveLength(1)
  })
})
