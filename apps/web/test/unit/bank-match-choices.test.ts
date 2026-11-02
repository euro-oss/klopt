import { describe, expect, it } from 'vitest'
import { buildMatchChoices, matchProgressPercent } from '../../src/lib/bank-match-choices.js'

describe('buildMatchChoices', () => {
  it('marks the invoice option suggested when the top suggestion has allocations', () => {
    const choices = buildMatchChoices([
      {
        strategy: 'reference',
        confidence: 99,
        reason: 'invoice in description',
        accountNumber: null,
        chargesAmount: '0',
        chargesAccountNumber: null,
        ruleId: null,
        allocations: [{ invoiceId: 'i1', number: '2026-0001', amount: '121000' }],
      },
    ])
    expect(choices.map((c) => c.id)).toEqual(['cost', 'invoice', 'transfer', 'other'])
    expect(choices.filter((c) => c.suggested)).toHaveLength(1)
    expect(choices[1]!.suggested).toBe(true)
    expect(choices[1]!.action.type).toBe('book_suggestion')
    expect(choices[1]!.invoiceNumbers).toEqual(['2026-0001'])
  })

  it('marks the cost option suggested when the top suggestion is a learned account', () => {
    const choices = buildMatchChoices([
      {
        strategy: 'learned_rule',
        confidence: 80,
        reason: 'remembered',
        accountNumber: '4400',
        chargesAmount: '0',
        chargesAccountNumber: null,
        ruleId: 'r1',
        allocations: [],
      },
    ])
    expect(choices.filter((c) => c.suggested)).toHaveLength(1)
    expect(choices[0]!.suggested).toBe(true)
    expect(choices[0]!.action.type).toBe('book_suggestion')
    expect(choices[0]!.accountNumber).toBe('4400')
  })

  it('suggests nothing when there are no suggestions', () => {
    const choices = buildMatchChoices([])
    expect(choices.every((c) => !c.suggested)).toBe(true)
    expect(choices.every((c) => c.action.type === 'open_form')).toBe(true)
  })
})

describe('matchProgressPercent', () => {
  it('is 0 / partial / 100', () => {
    expect(matchProgressPercent(0, 15)).toBe(0)
    expect(matchProgressPercent(1, 15)).toBe(7)
    expect(matchProgressPercent(15, 15)).toBe(100)
    expect(matchProgressPercent(0, 0)).toBe(100)
  })
})
