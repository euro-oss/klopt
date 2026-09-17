import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import type { BankEntry } from '../../src/bank/model.js'
import {
  DEFAULT_MATCH_OPTIONS,
  allocateOldestFirst,
  mentionsNumber,
  nameSimilarity,
  normaliseName,
  ruleToLearn,
  suggestMatches,
  type MatchCandidate,
  type MatchRule,
} from '../../src/bank/matching.js'

/**
 * The matching engine (spec 7.4).
 *
 * Every case here is one a real bank line produces, and the assertion is always
 * the same shape: which strategy fired, and roughly how sure it is. The
 * confidence numbers are asserted as ranges rather than exactly, because the
 * ordering is what matters — a queue is only as useful as its order — and
 * pinning the arithmetic would make every tuning change a test change.
 */

const entry = (overrides: Partial<BankEntry> = {}): BankEntry => ({
  amount: 121_000n,
  currency: 'EUR',
  bookingDate: '2026-04-02',
  valueDate: '2026-04-02',
  bankReference: 'REF1',
  endToEndId: null,
  counterpartyName: 'Grote Klant N.V.',
  counterpartyIban: 'NL91RABO0315273637',
  description: '',
  remittanceReference: null,
  transactionCode: 'NTRF',
  raw: '',
  ...overrides,
})

const invoice = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  invoiceId: 'i1',
  number: '2026-0001',
  kind: 'invoice',
  contactId: 'c1',
  contactName: 'Grote Klant N.V.',
  contactIban: 'NL91RABO0315273637',
  issueDate: '2026-03-01',
  dueDate: '2026-03-31',
  outstanding: 121_000n,
  currency: 'EUR',
  ...overrides,
})

const rule = (overrides: Partial<MatchRule> = {}): MatchRule => ({
  id: 'r1',
  source: 'learned',
  counterpartyIban: null,
  counterpartyName: null,
  descriptionContains: null,
  accountNumber: null,
  contactId: null,
  timesApplied: 1,
  isActive: true,
  ...overrides,
})

describe('the reference layer', () => {
  it('is nearly certain when the number and the amount both match', () => {
    const [best] = suggestMatches(
      entry({ description: 'Betaling factuur 2026-0001' }),
      [invoice()],
      [],
    )

    expect(best?.strategy).toBe('reference')
    expect(best?.confidence).toBeGreaterThanOrEqual(95)
    expect(best?.allocations).toEqual([{ invoiceId: 'i1', number: '2026-0001', amount: 121_000n }])
    expect(best?.reason).toContain('2026-0001')
  })

  it('finds the number in the end-to-end id, where a payer system puts it', () => {
    const [best] = suggestMatches(entry({ endToEndId: '2026-0001' }), [invoice()], [])
    expect(best?.strategy).toBe('reference')
  })

  it('finds it with the separators removed, which is how people type it', () => {
    const [best] = suggestMatches(entry({ description: 'fact 20260001' }), [invoice()], [])
    expect(best?.strategy).toBe('reference')
  })

  it('does not match inside a longer number', () => {
    // 2026-00012 is a different invoice, and this is the bug that would clear
    // the wrong one.
    const found = suggestMatches(entry({ description: 'factuur 2026-00012' }), [invoice()], [])
    expect(found.some((item) => item.strategy === 'reference')).toBe(false)
  })

  it('calls a short payment a partial payment, and allocates what arrived', () => {
    const [best] = suggestMatches(
      entry({ amount: 50_000n, description: 'factuur 2026-0001' }),
      [invoice()],
      [],
    )

    expect(best?.strategy).toBe('reference')
    expect(best?.confidence).toBeLessThan(95)
    expect(best?.reason).toContain('Deelbetaling')
    expect(best?.allocations[0]?.amount).toBe(50_000n)
  })

  it('allocates only what was owed when more arrives than was invoiced', () => {
    const [best] = suggestMatches(
      entry({ amount: 200_000n, description: 'factuur 2026-0001' }),
      [invoice()],
      [],
    )

    expect(best?.allocations[0]?.amount).toBe(121_000n)
    expect(best?.reason).toContain('meer ontvangen')
  })

  it('reads several numbers as a batch payment and says it adds up', () => {
    const [best] = suggestMatches(
      entry({ amount: 363_000n, description: 'facturen 2026-0002 2026-0003 2026-0004' }),
      [
        invoice({ invoiceId: 'a', number: '2026-0002' }),
        invoice({ invoiceId: 'b', number: '2026-0003' }),
        invoice({ invoiceId: 'c', number: '2026-0004' }),
      ],
      [],
    )

    expect(best?.strategy).toBe('reference')
    expect(best?.confidence).toBeGreaterThanOrEqual(95)
    expect(best?.allocations).toHaveLength(3)
    expect(best?.reason).toContain('precies')
  })

  it('is less sure about a batch that does not add up', () => {
    const [best] = suggestMatches(
      entry({ amount: 200_000n, description: 'facturen 2026-0002 en 2026-0003' }),
      [
        invoice({ invoiceId: 'a', number: '2026-0002' }),
        invoice({ invoiceId: 'b', number: '2026-0003' }),
      ],
      [],
    )

    expect(best?.confidence).toBeLessThan(95)
    expect(best?.reason).toContain('niet uit')
  })
})

describe('bank charges deducted from a payment', () => {
  const withCharges = { ...DEFAULT_MATCH_OPTIONS, chargesAccountNumber: '4900' }

  it('splits off a few euro and settles the invoice in full', () => {
    // A foreign transfer arrives a handful of euro short. That is a cost, not a
    // partial payment, and treating it as one leaves a debtor open for years.
    const [best] = suggestMatches(
      entry({ amount: 120_650n, description: 'factuur 2026-0001' }),
      [invoice()],
      [],
      withCharges,
    )

    expect(best?.chargesAmount).toBe(350n)
    expect(best?.chargesAccountNumber).toBe('4900')
    // Nothing is left over, so there is no remainder to place.
    expect(best?.accountNumber).toBeNull()
    expect(best?.allocations[0]?.amount).toBe(121_000n)
    expect(best?.reason).toContain('bankkosten')
  })

  it('refuses to call a large shortfall a bank charge', () => {
    const [best] = suggestMatches(
      entry({ amount: 100_000n, description: 'factuur 2026-0001' }),
      [invoice()],
      [],
      withCharges,
    )
    expect(best?.chargesAmount).toBe(0n)
    expect(best?.reason).toContain('Deelbetaling')
  })

  it('refuses a proportionally large shortfall even when it is small in euro', () => {
    // 3 euro off a 20 euro invoice is not a bank charge. Both a ceiling and a
    // proportion, because either alone gets one of these wrong.
    const [best] = suggestMatches(
      entry({ amount: 1_700n, description: 'factuur 2026-0009' }),
      [invoice({ number: '2026-0009', outstanding: 2_000n })],
      [],
      withCharges,
    )
    expect(best?.chargesAmount).toBe(0n)
  })

  it('does nothing when no charges account is configured', () => {
    const [best] = suggestMatches(
      entry({ amount: 120_650n, description: 'factuur 2026-0001' }),
      [invoice()],
      [],
    )
    expect(best?.chargesAmount).toBe(0n)
  })
})

describe('the IBAN and amount layer', () => {
  it('matches a known account paying an exact amount', () => {
    const [best] = suggestMatches(entry(), [invoice()], [])

    expect(best?.strategy).toBe('iban_amount')
    expect(best?.confidence).toBeGreaterThanOrEqual(85)
    expect(best?.allocations[0]?.invoiceId).toBe('i1')
  })

  it('refuses to choose between two invoices of the same amount', () => {
    const [best] = suggestMatches(
      entry(),
      [
        invoice({ invoiceId: 'a', number: '2026-0001' }),
        invoice({ invoiceId: 'b', number: '2026-0002' }),
      ],
      [],
    )

    expect(best?.allocations).toEqual([])
    expect(best?.reason).toContain('Kies welke')
    expect(best?.confidence).toBeLessThan(70)
  })

  it('falls back to oldest first when the amount matches nothing', () => {
    const [best] = suggestMatches(
      entry({ amount: 150_000n }),
      [
        invoice({
          invoiceId: 'a',
          number: '2026-0001',
          dueDate: '2026-03-31',
          outstanding: 100_000n,
        }),
        invoice({
          invoiceId: 'b',
          number: '2026-0002',
          dueDate: '2026-04-30',
          outstanding: 100_000n,
        }),
      ],
      [],
    )

    expect(best?.strategy).toBe('oldest_first')
    expect(best?.allocations).toEqual([
      { invoiceId: 'a', number: '2026-0001', amount: 100_000n },
      { invoiceId: 'b', number: '2026-0002', amount: 50_000n },
    ])
    expect(best?.reason).toContain('oudste')
  })
})

describe('learned rules', () => {
  it('applies one that matches on the account number', () => {
    const suggestions = suggestMatches(
      entry({
        amount: -4_550n,
        counterpartyName: 'Telecom B.V.',
        counterpartyIban: 'NL20INGB0001234567',
      }),
      [],
      [rule({ counterpartyIban: 'NL20INGB0001234567', accountNumber: '4410', timesApplied: 6 })],
    )

    const learned = suggestions.find((item) => item.strategy === 'learned_rule')
    expect(learned?.accountNumber).toBe('4410')
    expect(learned?.reason).toContain('Eerder zo geboekt')
    expect(learned?.reason).toContain('6x')
  })

  it('trusts a rule more the more often it has been used, but never completely', () => {
    const once = suggestMatches(
      entry({ amount: -100n, counterpartyIban: 'NL20INGB0001234567' }),
      [],
      [rule({ counterpartyIban: 'NL20INGB0001234567', accountNumber: '4900', timesApplied: 1 })],
    )[0]
    const often = suggestMatches(
      entry({ amount: -100n, counterpartyIban: 'NL20INGB0001234567' }),
      [],
      [rule({ counterpartyIban: 'NL20INGB0001234567', accountNumber: '4900', timesApplied: 50 })],
    )[0]

    expect(often!.confidence).toBeGreaterThan(once!.confidence)
    // A rule is a habit, and habits have exceptions.
    expect(often!.confidence).toBeLessThan(95)
  })

  it('matches on a description fragment when there is no IBAN', () => {
    const suggestions = suggestMatches(
      entry({
        amount: -215n,
        counterpartyName: null,
        counterpartyIban: null,
        description: 'Kosten betalingsverkeer',
      }),
      [],
      [rule({ descriptionContains: 'betalingsverkeer', accountNumber: '4900' })],
    )
    expect(suggestions[0]?.accountNumber).toBe('4900')
  })

  it('ignores an inactive rule', () => {
    const suggestions = suggestMatches(
      entry({ amount: -100n, counterpartyIban: 'NL20INGB0001234567' }),
      [],
      [rule({ counterpartyIban: 'NL20INGB0001234567', accountNumber: '4900', isActive: false })],
    )
    expect(suggestions).toEqual([])
  })

  it('ignores a rule with no conditions, which would match everything', () => {
    const suggestions = suggestMatches(
      entry({ amount: -100n }),
      [],
      [rule({ accountNumber: '4900' })],
    )
    expect(suggestions).toEqual([])
  })

  it('requires every condition on a rule to hold', () => {
    const both = rule({
      counterpartyIban: 'NL20INGB0001234567',
      descriptionContains: 'abonnement',
      accountNumber: '4410',
    })

    expect(
      suggestMatches(
        entry({
          amount: -100n,
          counterpartyIban: 'NL20INGB0001234567',
          description: 'abonnement maart',
        }),
        [],
        [both],
      ),
    ).toHaveLength(1)
    expect(
      suggestMatches(
        entry({
          amount: -100n,
          counterpartyIban: 'NL20INGB0001234567',
          description: 'iets anders',
        }),
        [],
        [both],
      ),
    ).toEqual([])
  })
})

describe('the fuzzy layer', () => {
  it('matches a name that is close and an amount that is exact', () => {
    const [best] = suggestMatches(
      entry({ counterpartyIban: null, counterpartyName: 'Grote Klant' }),
      [invoice({ contactIban: null })],
      [],
    )

    expect(best?.strategy).toBe('fuzzy_name')
    // The weakest layer, and it never pretends otherwise.
    expect(best?.confidence).toBeLessThan(80)
    expect(best?.reason).toContain('lijkt op')
  })

  it('does not fire on an unrelated name', () => {
    const found = suggestMatches(
      entry({ counterpartyIban: null, counterpartyName: 'Bakkerij Van Dam' }),
      [invoice({ contactIban: null })],
      [],
    )
    expect(found).toEqual([])
  })
})

describe('what is never suggested', () => {
  it('a credit note for money coming in', () => {
    const found = suggestMatches(entry(), [invoice({ kind: 'credit_note' })], [])
    expect(found).toEqual([])
  })

  it('a sales invoice for money going out', () => {
    const found = suggestMatches(
      entry({ amount: -121_000n, description: 'factuur 2026-0001' }),
      [invoice()],
      [],
    )
    expect(found).toEqual([])
  })

  it('an invoice in another currency', () => {
    const found = suggestMatches(
      entry({ description: 'factuur 2026-0001' }),
      [invoice({ currency: 'USD' })],
      [],
    )
    expect(found).toEqual([])
  })

  it('an invoice with nothing outstanding', () => {
    const found = suggestMatches(
      entry({ description: 'factuur 2026-0001' }),
      [invoice({ outstanding: 0n })],
      [],
    )
    expect(found).toEqual([])
  })

  it('anything at all for a line with no amount', () => {
    expect(() => suggestMatches(entry({ amount: 0n }), [invoice()], [])).toThrow(LedgerError)
  })
})

describe('ordering', () => {
  it('puts the reference above the IBAN above the guess', () => {
    const suggestions = suggestMatches(
      entry({ description: 'factuur 2026-0001' }),
      [invoice()],
      [rule({ counterpartyIban: 'NL91RABO0315273637', accountNumber: '8000', timesApplied: 3 })],
    )

    expect(suggestions.map((item) => item.strategy)).toEqual([
      'reference',
      'iban_amount',
      'learned_rule',
    ])
  })
})

describe('name normalisation', () => {
  it('strips legal forms, which carry no information', () => {
    expect(normaliseName('Grote Klant N.V.')).toBe('grote klant')
    expect(normaliseName('Jansen Beheer B.V.')).toBe('jansen')
  })

  it('strips diacritics, because a bank might not send them', () => {
    expect(normaliseName('Sébastien Café')).toBe('sebastien cafe')
  })

  it('is insensitive to word order, which edit distance is not', () => {
    expect(nameSimilarity('Jansen Transport', 'Transport Jansen')).toBeGreaterThan(0.8)
  })

  it('scores identical names 1 and unrelated ones near 0', () => {
    expect(nameSimilarity('Grote Klant N.V.', 'Grote Klant')).toBe(1)
    expect(nameSimilarity('Grote Klant', 'Bakkerij Van Dam')).toBeLessThan(0.3)
  })

  it('handles an empty name without dividing by zero', () => {
    expect(nameSimilarity('', 'Grote Klant')).toBe(0)
  })
})

describe('recognising a number', () => {
  it('needs at least four characters, so "1" does not match everything', () => {
    expect(mentionsNumber('betaling 1 stuk', '1')).toBe(false)
    expect(mentionsNumber('betaling 0001', '0001')).toBe(true)
  })

  it('is bounded by digits, not by letters', () => {
    expect(mentionsNumber('ref20260001x', '2026-0001')).toBe(true)
    expect(mentionsNumber('ref202600011', '2026-0001')).toBe(false)
  })
})

describe('what a confirmation teaches', () => {
  it('learns the account number, which is exact', () => {
    const learned = ruleToLearn(
      entry({ counterpartyIban: 'NL20INGB0001234567', counterpartyName: 'Telecom B.V.' }),
      { accountNumber: '4410', contactId: null },
    )

    expect(learned).toMatchObject({
      counterpartyIban: 'NL20INGB0001234567',
      counterpartyName: null,
      accountNumber: '4410',
    })
  })

  it('falls back to the name when there is no account number', () => {
    const learned = ruleToLearn(
      entry({ counterpartyIban: null, counterpartyName: 'Telecom B.V.' }),
      { accountNumber: '4410', contactId: null },
    )
    expect(learned).toMatchObject({ counterpartyName: 'Telecom B.V.', counterpartyIban: null })
  })

  it('falls back to the most distinctive word of the description', () => {
    const learned = ruleToLearn(
      entry({
        counterpartyIban: null,
        counterpartyName: null,
        description: 'Kosten betalingsverkeer',
      }),
      { accountNumber: '4900', contactId: null },
    )
    // Not the whole description: a rule on a whole description matches nothing
    // a second time.
    expect(learned?.descriptionContains).toBe('betalingsverkeer')
  })

  it('learns nothing when the human chose nothing to learn from', () => {
    expect(ruleToLearn(entry(), { accountNumber: null, contactId: null })).toBeNull()
  })

  it('learns nothing from a line with no counterparty and no words', () => {
    expect(
      ruleToLearn(entry({ counterpartyIban: null, counterpartyName: null, description: 'ab cd' }), {
        accountNumber: '4900',
        contactId: null,
      }),
    ).toBeNull()
  })
})

describe('oldest-first allocation', () => {
  it('stops at what arrived', () => {
    const allocations = allocateOldestFirst(
      [
        invoice({ invoiceId: 'a', dueDate: '2026-01-31', outstanding: 30_000n }),
        invoice({ invoiceId: 'b', dueDate: '2026-02-28', outstanding: 30_000n }),
      ],
      40_000n,
      true,
    )

    expect(allocations.map((item) => item.amount)).toEqual([30_000n, 10_000n])
  })

  it('signs an outgoing allocation the other way', () => {
    const allocations = allocateOldestFirst([invoice({ outstanding: 10_000n })], 10_000n, false)
    expect(allocations[0]?.amount).toBe(-10_000n)
  })
})
