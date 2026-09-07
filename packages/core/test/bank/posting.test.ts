import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import { buildBankMatchEntry, type BankMatchRequest } from '../../src/bank/posting.js'

/**
 * A matched bank line, as a journal entry.
 *
 * One rule holds every case together: **the bank side is the transaction,
 * exactly.** Whatever the bank says moved is what moves on the bank account,
 * and the other side is what the human decided it was for. So every test here
 * checks the bank line first and the balance second.
 */

const request = (overrides: Partial<BankMatchRequest> = {}): BankMatchRequest => ({
  entityId: 'e1',
  journalCode: 'BNK',
  bookingDate: '2026-04-02',
  valueDate: '2026-04-02',
  bankAccountNumber: '1100',
  amount: 121_000n,
  currency: 'EUR',
  counterpartyName: 'Grote Klant N.V.',
  description: 'Betaling factuur 2026-0001',
  receivableAccountNumber: '1300',
  allocations: [
    {
      invoiceId: 'i1',
      invoiceNumber: '2026-0001',
      amount: 121_000n,
      contactNumber: 'DEB-0001',
      contactName: 'Grote Klant N.V.',
      contactId: 'c1',
    },
  ],
  remainderAccountNumber: null,
  chargesAmount: 0n,
  chargesAccountNumber: null,
  ...overrides,
})

const totals = (command: ReturnType<typeof buildBankMatchEntry>) => ({
  debit: command.lines.reduce((sum, line) => sum + line.debit, 0n),
  credit: command.lines.reduce((sum, line) => sum + line.credit, 0n),
})

describe('a customer payment', () => {
  it('debits the bank and credits debiteuren, and balances', () => {
    const command = buildBankMatchEntry(request())

    expect(command.lines[0]).toMatchObject({ accountNumber: '1100', debit: 121_000n })
    expect(command.lines[1]).toMatchObject({ accountNumber: '1300', credit: 121_000n })
    expect(totals(command)).toEqual({ debit: 121_000n, credit: 121_000n })
  })

  it('carries the subledger link, which is what makes the debtors ledger work', () => {
    const command = buildBankMatchEntry(request())
    expect(command.lines[1]).toMatchObject({ subledgerKind: 'customer', subledgerId: 'c1' })
    expect(command.lines[1]?.description).toContain('2026-0001')
  })

  it('references the invoices it settles', () => {
    expect(buildBankMatchEntry(request()).sourceDocumentRef).toBe('2026-0001')
  })
})

describe('a payment a few euro short', () => {
  it('settles the invoice in full and books the difference as charges', () => {
    // 1206.50 arrived, 1210.00 was owed, 3.50 the bank kept. The invoice is
    // paid; the shortfall is a cost. Treating it as a partial payment leaves a
    // debtor open for years.
    const command = buildBankMatchEntry(
      request({
        amount: 120_650n,
        chargesAmount: 350n,
        chargesAccountNumber: '4900',
      }),
    )

    expect(command.lines[0]).toMatchObject({ accountNumber: '1100', debit: 120_650n })
    expect(command.lines[1]).toMatchObject({ accountNumber: '4900', debit: 350n })
    expect(command.lines[2]).toMatchObject({ accountNumber: '1300', credit: 121_000n })
    expect(totals(command)).toEqual({ debit: 121_000n, credit: 121_000n })
  })

  it('refuses charges with no account to post them to', () => {
    expect(() => buildBankMatchEntry(request({ amount: 120_650n, chargesAmount: 350n }))).toThrow(
      /account to post to/,
    )
  })

  it('refuses negative charges', () => {
    expect(() =>
      buildBankMatchEntry(request({ chargesAmount: -1n, chargesAccountNumber: '4900' })),
    ).toThrow(LedgerError)
  })
})

describe('a partial payment', () => {
  it('allocates what arrived and leaves the invoice open for the rest', () => {
    const command = buildBankMatchEntry(
      request({
        amount: 50_000n,
        allocations: [{ ...request().allocations[0]!, amount: 50_000n }],
      }),
    )

    expect(totals(command)).toEqual({ debit: 50_000n, credit: 50_000n })
    expect(command.lines).toHaveLength(2)
  })
})

describe('a batch payment', () => {
  it('writes one control line per invoice, so each is cleared by name', () => {
    const command = buildBankMatchEntry(
      request({
        amount: 363_000n,
        allocations: [
          {
            ...request().allocations[0]!,
            invoiceId: 'a',
            invoiceNumber: '2026-0002',
            amount: 121_000n,
          },
          {
            ...request().allocations[0]!,
            invoiceId: 'b',
            invoiceNumber: '2026-0003',
            amount: 121_000n,
          },
          {
            ...request().allocations[0]!,
            invoiceId: 'c',
            invoiceNumber: '2026-0004',
            amount: 121_000n,
          },
        ],
      }),
    )

    expect(command.lines).toHaveLength(4)
    expect(totals(command)).toEqual({ debit: 363_000n, credit: 363_000n })
    expect(command.sourceDocumentRef).toBe('2026-0002, 2026-0003, 2026-0004')
  })
})

describe('a line that is not a customer payment at all', () => {
  it('books a direct debit straight to an expense account', () => {
    const command = buildBankMatchEntry(
      request({
        amount: -4_550n,
        counterpartyName: 'Telecom B.V.',
        description: 'Abonnement maart',
        allocations: [],
        remainderAccountNumber: '4410',
      }),
    )

    expect(command.lines[0]).toMatchObject({ accountNumber: '1100', credit: 4_550n })
    expect(command.lines[1]).toMatchObject({ accountNumber: '4410', debit: 4_550n })
    expect(totals(command)).toEqual({ debit: 4_550n, credit: 4_550n })
    expect(command.description).toBe('Abonnement maart')
  })

  it('books a receipt with no invoice to the account chosen', () => {
    const command = buildBankMatchEntry(
      request({ amount: 50_000n, allocations: [], remainderAccountNumber: '1110' }),
    )
    expect(command.lines[0]).toMatchObject({ accountNumber: '1100', debit: 50_000n })
    expect(command.lines[1]).toMatchObject({ accountNumber: '1110', credit: 50_000n })
  })
})

describe('what is refused', () => {
  it('a line of zero', () => {
    expect(() => buildBankMatchEntry(request({ amount: 0n, allocations: [] }))).toThrow(LedgerError)
  })

  it('a remainder with nowhere to go', () => {
    // 1500.00 arrived against a 1210.00 invoice. The 290.00 is real money and
    // has to belong somewhere; guessing would post it to the wrong place
    // silently.
    expect(() => buildBankMatchEntry(request({ amount: 150_000n }))).toThrow(/not accounted for/)
  })

  it('allocations that exceed the line', () => {
    expect(() =>
      buildBankMatchEntry(
        request({
          amount: 50_000n,
          allocations: [{ ...request().allocations[0]!, amount: 121_000n }],
        }),
      ),
    ).toThrow(/more than the/)
  })

  it('an allocation pointing the wrong way', () => {
    // Clearing an invoice with money that went in the opposite direction is
    // never what happened.
    expect(() =>
      buildBankMatchEntry(
        request({ allocations: [{ ...request().allocations[0]!, amount: -121_000n }] }),
      ),
    ).toThrow(/same way as the payment/)
  })

  it('and it reports every problem at once', () => {
    let violations: readonly { code: string }[] = []
    try {
      buildBankMatchEntry(request({ amount: 0n, chargesAmount: -5n, allocations: [] }))
    } catch (error: unknown) {
      if (!(error instanceof LedgerError)) throw error
      violations = error.violations
    }
    expect(violations.length).toBeGreaterThan(1)
  })
})
