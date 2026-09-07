import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BankStatementError, parseBankAmount } from '../../src/bank/model.js'
import { parseCamt053 } from '../../src/bank/camt.js'
import { parseMt940 } from '../../src/bank/mt940.js'
import {
  dedupeKey,
  detectBankFormat,
  normaliseIban,
  parseBankFile,
  planImport,
} from '../../src/bank/import.js'

/**
 * Bank statement import (spec 7.4).
 *
 * The claim being tested is the one the rest of M2 rests on: **"API and file
 * import must produce an identical transaction stream so nothing downstream
 * cares which one is in use."** So the same two statements are given as MT940
 * and as CAMT.053, and the parsed result is compared field by field. If the two
 * ever diverge, the matching engine is matching on whichever format happened to
 * be imported, and nobody will notice until a reconciliation disagrees.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const mt940 = parseMt940(read('statement.mt940'))
const camt = parseCamt053(read('statement.camt.xml'))

describe('amounts', () => {
  it('reads both separators, because MT940 and CAMT disagree', () => {
    expect(parseBankAmount('1234,56', 'x')).toBe(123_456n)
    expect(parseBankAmount('1234.56', 'x')).toBe(123_456n)
    expect(parseBankAmount('0,05', 'x')).toBe(5n)
    expect(parseBankAmount('1210', 'x')).toBe(121_000n)
  })

  it('never goes through a float', () => {
    // 12345678901234.56 has already lost data as a Number.
    expect(parseBankAmount('12345678901234.56', 'x')).toBe(1_234_567_890_123_456n)
  })

  it('refuses what is not an amount', () => {
    for (const bad of ['', 'x', '1.234.56', '1,2,3', '12.345']) {
      expect(() => parseBankAmount(bad, 'x'), bad).toThrow(BankStatementError)
    }
  })
})

describe('MT940', () => {
  it('reads every statement in the file, not only the first', () => {
    // One per day is normal, and keeping the first silently loses a week.
    expect(mt940).toHaveLength(2)
    expect(mt940.map((statement) => statement.sequenceNumber)).toEqual([41, 42])
  })

  it('reads the account, the balances and the period', () => {
    const [first] = mt940
    expect(first?.accountIban).toBe('NL02ABNA0123456789')
    expect(first?.currency).toBe('EUR')
    expect(first?.openingBalance).toBe(125_000n)
    expect(first?.closingBalance).toBe(291_450n)
    expect(first?.openingDate).toBe('2026-03-01')
    expect(first?.closingDate).toBe('2026-03-04')
  })

  it('signs the amounts so positive is money in', () => {
    expect(mt940[0]?.entries.map((entry) => entry.amount)).toEqual([121_000n, -4_550n, 50_000n])
  })

  it('reads the value date and the entry date separately', () => {
    const [entry] = mt940[0]?.entries ?? []
    expect(entry?.valueDate).toBe('2026-03-02')
    expect(entry?.bookingDate).toBe('2026-03-02')
  })

  it('pulls the counterparty out of the free-text :86: block', () => {
    const [entry] = mt940[0]?.entries ?? []
    expect(entry?.counterpartyName).toBe('Grote Klant N.V.')
    expect(entry?.counterpartyIban).toBe('NL91RABO0315273637')
    expect(entry?.endToEndId).toBe('2026-0001')
    expect(entry?.description).toBe('Factuur 2026-0001')
  })

  it('keeps an unstructured :86: as the description rather than dropping it', () => {
    // ABN AMRO writes free text with no subfields at all. Discarding it because
    // it was not tagged would lose the only description the bank gave.
    const entry = mt940[0]?.entries[2]
    expect(entry?.description).toBe('Overboeking spaarrekening')
    expect(entry?.counterpartyName).toBeNull()
  })

  it('reads the bank reference after the double slash', () => {
    expect(mt940[0]?.entries[0]?.bankReference).toBe('ABNA20260302001')
  })

  it('treats NONREF as no reference', () => {
    expect(mt940[0]?.entries[0]?.remittanceReference).toBeNull()
    // MANDATE-9 is a real owner reference and is kept.
    expect(mt940[0]?.entries[1]?.remittanceReference).toBe('MANDATE-9')
  })

  it('reads a D balance as an overdraft', () => {
    const overdrawn = parseMt940(
      [
        ':20:X',
        ':25:NL02ABNA0123456789',
        ':28C:1/1',
        ':60F:D260301EUR100,00',
        ':62F:D260301EUR100,00',
      ].join('\n'),
    )
    expect(overdrawn[0]?.openingBalance).toBe(-10_000n)
  })

  it('refuses a file with no balances rather than guessing', () => {
    expect(() => parseMt940(':20:X\n:25:NL02ABNA0123456789\n')).toThrow(BankStatementError)
  })
})

describe('CAMT.053', () => {
  it('reads the account, the balances and the period', () => {
    const [first] = camt
    expect(first?.accountIban).toBe('NL02ABNA0123456789')
    expect(first?.openingBalance).toBe(125_000n)
    expect(first?.closingBalance).toBe(291_450n)
    expect(first?.openingDate).toBe('2026-03-01')
    expect(first?.closingDate).toBe('2026-03-04')
    expect(first?.sequenceNumber).toBe(41)
  })

  it('takes the counterparty from the side the direction implies', () => {
    // A credit's counterparty is the debtor; a debit's is the creditor. Reading
    // Dbtr unconditionally is right half the time, which is the worst rate
    // there is for something a matching engine then learns from.
    const [received, paid] = camt[0]?.entries ?? []
    expect(received?.amount).toBeGreaterThan(0n)
    expect(received?.counterpartyName).toBe('Grote Klant N.V.')
    expect(paid?.amount).toBeLessThan(0n)
    expect(paid?.counterpartyName).toBe('Telecom B.V.')
    expect(paid?.counterpartyIban).toBe('NL20INGB0001234567')
  })

  it('reads a structured creditor reference when the payer used one', () => {
    expect(camt[0]?.entries[1]?.remittanceReference).toBe('ABO-2026-03')
  })

  it('falls back to AddtlNtryInf, which is where some banks put the description', () => {
    expect(camt[0]?.entries[2]?.description).toBe('Overboeking spaarrekening')
  })

  it('defaults the value date to the booking date when it is absent', () => {
    const entry = camt[0]?.entries[2]
    expect(entry?.valueDate).toBe('2026-03-04')
  })

  it('keeps a batch as one entry, because that is what the balance moved by', () => {
    const [statement] = parseCamt053(read('batch.camt.xml'))
    expect(statement?.entries).toHaveLength(1)
    expect(statement?.entries[0]?.amount).toBe(363_000n)
    // The details are still read, so the matching engine can split it.
    expect(statement?.entries[0]?.description).toContain('Factuur 2026-0002')
    expect(statement?.entries[0]?.description).toContain('Factuur 2026-0004')
  })

  it('refuses something that is not a statement', () => {
    expect(() => parseCamt053('<Document><Other/></Document>')).toThrow(BankStatementError)
  })

  it('refuses a DOCTYPE, because a statement arrives from outside', () => {
    expect(() =>
      parseCamt053('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Document/>'),
    ).toThrow()
  })
})

describe('the two formats agree', () => {
  it('produces the same stream from the same statement', () => {
    // The claim spec 7.4 makes, checked rather than asserted in a comment.
    const fromMt940 = mt940[0]
    const fromCamt = camt[0]

    expect(fromCamt?.accountIban).toBe(fromMt940?.accountIban)
    expect(fromCamt?.openingBalance).toBe(fromMt940?.openingBalance)
    expect(fromCamt?.closingBalance).toBe(fromMt940?.closingBalance)
    expect(fromCamt?.sequenceNumber).toBe(fromMt940?.sequenceNumber)

    const comparable = (statement: typeof fromMt940) =>
      statement?.entries.map((entry) => ({
        amount: entry.amount,
        bookingDate: entry.bookingDate,
        valueDate: entry.valueDate,
        bankReference: entry.bankReference,
        endToEndId: entry.endToEndId,
        counterpartyName: entry.counterpartyName,
        counterpartyIban: entry.counterpartyIban,
      }))

    expect(comparable(fromCamt)).toEqual(comparable(fromMt940))
  })
})

describe('sniffing the format', () => {
  it('recognises all three, and refuses what it does not know', () => {
    expect(detectBankFormat(read('statement.camt.xml'))).toBe('camt.053')
    expect(detectBankFormat(read('statement.mt940'))).toBe('mt940')
    // Not a guess about *which* CSV, only that a mapping will be needed.
    expect(detectBankFormat('date,amount\n2026-01-01,10')).toBe('csv')
    expect(() => detectBankFormat('just some prose with no separators')).toThrow(BankStatementError)
  })

  it('refuses to parse a delimited file without a mapping', () => {
    // Returning nothing would be worse than saying what is missing.
    expect(() => parseBankFile('date,amount\n2026-01-01,10')).toThrow(/needs a column mapping/)
  })

  it('parses either through one entry point', () => {
    expect(parseBankFile(read('statement.mt940'))[0]?.format).toBe('mt940')
    expect(parseBankFile(read('statement.camt.xml'))[0]?.format).toBe('camt.053')
  })
})

describe('deduplication', () => {
  const statement = { accountIban: 'NL02ABNA0123456789', statementId: 'S1', sequenceNumber: 41 }
  const entry = mt940[0]!.entries[0]!

  it('uses the bank reference when there is one', () => {
    expect(dedupeKey(entry, statement, 0)).toBe('ref:ABNA20260302001')
  })

  it('hashes the content when there is not', () => {
    const anonymous = { ...entry, bankReference: null }
    const key = dedupeKey(anonymous, statement, 0)
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/)
    // Stable, so re-importing the same file finds the same key.
    expect(dedupeKey(anonymous, statement, 0)).toBe(key)
  })

  it('distinguishes two identical entries in the same statement', () => {
    // Two card payments of the same amount to the same shop on the same day is
    // an ordinary Tuesday. Hashing them together would drop one.
    const anonymous = { ...entry, bankReference: null }
    expect(dedupeKey(anonymous, statement, 0)).not.toBe(dedupeKey(anonymous, statement, 1))
  })

  it('changes when the amount does', () => {
    const anonymous = { ...entry, bankReference: null }
    expect(dedupeKey(anonymous, statement, 0)).not.toBe(
      dedupeKey({ ...anonymous, amount: 1n }, statement, 0),
    )
  })
})

describe('planning an import', () => {
  const context = {
    accountIban: 'NL02ABNA0123456789',
    currency: 'EUR',
    lastSequenceNumber: 40,
  }

  it('accepts a clean file with nothing to report', () => {
    const plan = planImport(mt940, context)
    expect(plan.problems).toEqual([])
    expect(plan.dedupeKeys).toHaveLength(4)
  })

  it('warns about a gap, because a missing statement is a wrong balance', () => {
    const plan = planImport(mt940, { ...context, lastSequenceNumber: 38 })
    const gap = plan.problems.find((problem) => problem.code === 'sequence_gap')
    expect(gap?.severity).toBe('warning')
    expect(gap?.message).toContain('39 to 40')
  })

  it('says so when there is no sequence number to check', () => {
    const [first] = mt940
    const plan = planImport([{ ...first!, sequenceNumber: null }], context)
    expect(plan.problems.map((problem) => problem.code)).toContain('no_sequence_number')
  })

  it('refuses a file whose entries do not add up to its closing balance', () => {
    const [first] = mt940
    const truncated = { ...first!, entries: first!.entries.slice(0, 1) }
    const problem = planImport([truncated], context).problems.find(
      (item) => item.code === 'balance_walk_mismatch',
    )
    expect(problem?.severity).toBe('error')
    expect(problem?.message).toContain('truncated or was misread')
  })

  it('refuses a file for the wrong account', () => {
    const plan = planImport(mt940, { ...context, accountIban: 'NL91RABO0315273637' })
    expect(plan.problems.map((problem) => problem.code)).toContain('account_mismatch')
  })

  it('compares IBANs without spaces or case, because banks print them both ways', () => {
    const plan = planImport(mt940, { ...context, accountIban: 'nl02 abna 0123 4567 89' })
    expect(plan.problems).toEqual([])
    expect(normaliseIban('nl02 abna 0123 4567 89')).toBe('NL02ABNA0123456789')
  })

  it('refuses a file in the wrong currency', () => {
    const plan = planImport(mt940, { ...context, currency: 'USD' })
    expect(plan.problems.map((problem) => problem.code)).toContain('currency_mismatch')
  })

  it('reports gaps sensibly even when the statements arrive out of order', () => {
    const plan = planImport([mt940[1]!, mt940[0]!], context)
    expect(plan.problems).toEqual([])
  })
})
