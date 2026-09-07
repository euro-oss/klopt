import { describe, expect, it } from 'vitest'
import { convertToFunctional, multiplyByRate } from '../../src/ledger/currency.js'
import { postJournalEntry } from '../../src/ledger/posting.js'
import { functionalBalance } from '../../src/ledger/validation.js'
import { uuidv7 } from '../../src/ids.js'
import { FakeLedgerRepository, fakeClock } from '../support/fake-repository.js'
import type { JournalLineInput } from '../../src/ledger/types.js'

describe('multiplyByRate', () => {
  it('rounds half up, in integers', () => {
    expect(multiplyByRate(100_00n, '0.92')).toBe(92_00n)
    expect(multiplyByRate(333n, '0.335')).toBe(112n) // 111.555 -> 112
    expect(multiplyByRate(1000n, '0.335')).toBe(335n)
    expect(multiplyByRate(1n, '0.5')).toBe(1n) // 0.5 -> 1, not 0
    expect(multiplyByRate(3n, '0.5')).toBe(2n) // 1.5 -> 2
  })

  it('handles amounts no float could', () => {
    // 123456789012345678 x 1.000000000001 = 123456789012469134.789...
    // Well past the 2^53 boundary, so a float could not represent either
    // operand exactly, let alone the product.
    expect(multiplyByRate(123456789012345678n, '1.000000000001')).toBe(123456789012469135n)
  })
})

describe('converting an entry to the functional currency', () => {
  it('allocates on the total, not line by line', () => {
    // Three debits of 3.33, 3.33, 3.34 against a credit of 10.00, at 0.335.
    // Converted independently the debits come to 3.36 and the credit to 3.35.
    const lines = [
      { lineNumber: 1, currency: 'USD', debit: 333n, credit: 0n, exchangeRate: '0.335' },
      { lineNumber: 2, currency: 'USD', debit: 333n, credit: 0n, exchangeRate: '0.335' },
      { lineNumber: 3, currency: 'USD', debit: 334n, credit: 0n, exchangeRate: '0.335' },
      { lineNumber: 4, currency: 'USD', debit: 0n, credit: 1000n, exchangeRate: '0.335' },
    ]

    const { amounts, residual } = convertToFunctional(lines)

    expect(residual).toBe(0n)
    const debitTotal = amounts.reduce((total, item) => total + item.functionalDebit, 0n)
    const creditTotal = amounts.reduce((total, item) => total + item.functionalCredit, 0n)
    expect(debitTotal).toBe(335n)
    expect(creditTotal).toBe(335n)
    // The odd cent goes to one line, deterministically, rather than being lost.
    expect(amounts.slice(0, 3).map((item) => item.functionalDebit)).toEqual([112n, 111n, 112n])
  })

  it('leaves functional-currency lines untouched', () => {
    const { amounts, residual } = convertToFunctional([
      { lineNumber: 1, currency: 'EUR', debit: 100_00n, credit: 0n, exchangeRate: null },
      { lineNumber: 2, currency: 'EUR', debit: 0n, credit: 100_00n, exchangeRate: null },
    ])

    expect(residual).toBe(0n)
    expect(amounts[0]?.functionalDebit).toBe(100_00n)
    expect(amounts[1]?.functionalCredit).toBe(100_00n)
  })

  it('reports a residual when one currency carries two rates', () => {
    // An invoice booked at 0.92 settled at 0.94: a realised exchange result,
    // not a rounding artefact, and it needs its own account.
    const { residual } = convertToFunctional([
      { lineNumber: 1, currency: 'USD', debit: 100_00n, credit: 0n, exchangeRate: '0.94' },
      { lineNumber: 2, currency: 'USD', debit: 0n, credit: 100_00n, exchangeRate: '0.92' },
    ])

    expect(residual).toBe(200n)
  })

  it('is deterministic, so the hash is stable', () => {
    const lines = [
      { lineNumber: 1, currency: 'USD', debit: 3333n, credit: 0n, exchangeRate: '1.10345' },
      { lineNumber: 2, currency: 'USD', debit: 3333n, credit: 0n, exchangeRate: '1.10345' },
      { lineNumber: 3, currency: 'USD', debit: 3334n, credit: 0n, exchangeRate: '1.10345' },
      { lineNumber: 4, currency: 'USD', debit: 0n, credit: 10000n, exchangeRate: '1.10345' },
    ]
    expect(convertToFunctional(lines)).toEqual(convertToFunctional(lines))
  })
})

function line(overrides: Partial<JournalLineInput> & { accountNumber: string }): JournalLineInput {
  return {
    description: null,
    debit: 0n,
    credit: 0n,
    currency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    taxCode: null,
    taxRole: null,
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
    ...overrides,
  }
}

describe('posting with foreign currency', () => {
  const post = async (lines: JournalLineInput[]) => {
    const entityId = uuidv7()
    const repository = new FakeLedgerRepository(entityId)
    return postJournalEntry(
      {
        entityId,
        journalCode: 'MEM',
        bookingDate: '2026-06-15',
        documentDate: '2026-06-15',
        description: 'FX',
        sourceDocumentRef: null,
        reversesEntryId: null,
        lines,
      },
      { kind: 'human', id: 'user', principalId: null },
      {
        dryRun: false,
        idempotencyKey: uuidv7(),
        requestId: null,
        ip: null,
        mayPostToSoftClosedPeriod: false,
      },
      { repository, clock: fakeClock() },
    )
  }

  it('produces an entry that balances in both currencies', async () => {
    const result = await post([
      line({
        accountNumber: '1000',
        debit: 333n,
        currency: 'USD',
        exchangeRate: '0.335',
        exchangeRateSource: 'ECB',
      }),
      line({
        accountNumber: '1100',
        debit: 333n,
        currency: 'USD',
        exchangeRate: '0.335',
        exchangeRateSource: 'ECB',
      }),
      line({
        accountNumber: '1300',
        debit: 334n,
        currency: 'USD',
        exchangeRate: '0.335',
        exchangeRateSource: 'ECB',
      }),
      line({
        accountNumber: '8000',
        credit: 1000n,
        currency: 'USD',
        exchangeRate: '0.335',
        exchangeRateSource: 'ECB',
      }),
    ])

    expect(functionalBalance(result.entry.lines)).toBe(0n)
  })

  it('refuses to absorb a realised exchange result silently', async () => {
    await expect(
      post([
        line({
          accountNumber: '1000',
          debit: 100_00n,
          currency: 'USD',
          exchangeRate: '0.94',
          exchangeRateSource: 'ECB',
        }),
        line({
          accountNumber: '1100',
          credit: 100_00n,
          currency: 'USD',
          exchangeRate: '0.92',
          exchangeRateSource: 'ECB',
        }),
      ]),
    ).rejects.toMatchObject({ code: 'entry_unbalanced_functional' })
  })

  it('accepts it once the user posts the difference themselves', async () => {
    const result = await post([
      line({
        accountNumber: '1000',
        debit: 100_00n,
        currency: 'USD',
        exchangeRate: '0.94',
        exchangeRateSource: 'ECB',
      }),
      line({
        accountNumber: '1100',
        credit: 100_00n,
        currency: 'USD',
        exchangeRate: '0.92',
        exchangeRateSource: 'ECB',
      }),
      // Koersverschil, in the functional currency, explicit and visible.
      line({ accountNumber: '4000', credit: 200n, description: 'Koersverschil' }),
    ])

    expect(functionalBalance(result.entry.lines)).toBe(0n)
  })
})
