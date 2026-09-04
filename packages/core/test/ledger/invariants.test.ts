import { describe, expect, it } from 'vitest'
import { verifyHashChain } from '../../src/ledger/hash.js'
import { balanceByCurrency, functionalBalance } from '../../src/ledger/validation.js'
import { buildTrialBalance, type BalanceRow } from '../../src/ledger/reports.js'
import { postJournalEntry } from '../../src/ledger/posting.js'
import type { JournalLineInput, PostJournalEntryCommand } from '../../src/ledger/types.js'
import { uuidv7 } from '../../src/ids.js'
import { FakeLedgerRepository, fakeClock } from '../support/fake-repository.js'

/**
 * Ledger invariants as property tests (spec 11.4).
 *
 * "For any random sequence of postings: the trial balance nets to zero,
 * subledgers equal their control accounts, and the hash chain verifies."
 *
 * These drive the real `postJournalEntry` through an in-memory repository. An
 * earlier version generated the posted entries itself and checked those, which
 * is worth nothing: it passed while the service had a real FX rounding bug,
 * because the generator had the same bug.
 *
 * A deterministic xorshift rather than a fuzzing library, so a failing seed is
 * reproducible and @klopt/core keeps its empty dependency list.
 */

function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

const ACCOUNTS = ['1000', '1100', '1300', '1600', '4000', '8000'] as const
/** Awkward on purpose: rates whose products land on a half-cent boundary often. */
const RATES = ['0.335', '0.92', '1.10345', '0.007'] as const

function line(overrides: Partial<JournalLineInput> & { accountNumber: string }): JournalLineInput {
  return {
    description: null,
    debit: 0n,
    credit: 0n,
    currency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    taxCode: null,
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
    ...overrides,
  }
}

/**
 * A random entry that balances in its transaction currency: n-1 random debits
 * and one balancing credit, which is how a real posting is built.
 */
function generateCommand(random: () => number, entityId: string): PostJournalEntryCommand {
  const foreign = random() < 0.5
  const currency = foreign ? 'USD' : null
  const rate = foreign ? RATES[Math.floor(random() * RATES.length)]! : null

  const debitCount = 1 + Math.floor(random() * 4)
  const amounts = Array.from({ length: debitCount }, () =>
    BigInt(1 + Math.floor(random() * 999_99)),
  )
  const total = amounts.reduce((sum, amount) => sum + amount, 0n)

  const lines: JournalLineInput[] = amounts.map((amount) =>
    line({
      accountNumber: ACCOUNTS[Math.floor(random() * ACCOUNTS.length)]!,
      debit: amount,
      currency,
      exchangeRate: rate,
      exchangeRateSource: rate === null ? null : 'ECB',
    }),
  )

  lines.push(
    line({
      accountNumber: ACCOUNTS[Math.floor(random() * ACCOUNTS.length)]!,
      credit: total,
      currency,
      exchangeRate: rate,
      exchangeRateSource: rate === null ? null : 'ECB',
    }),
  )

  const month = 1 + Math.floor(random() * 12)
  const day = 1 + Math.floor(random() * 28)
  const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return {
    entityId,
    journalCode: 'MEM',
    bookingDate: date,
    documentDate: date,
    description: `Generated entry`,
    sourceDocumentRef: null,
    reversesEntryId: null,
    lines,
  }
}

async function postMany(seed: number, count: number): Promise<FakeLedgerRepository> {
  const entityId = uuidv7()
  const repository = new FakeLedgerRepository(entityId)
  const clock = fakeClock()
  const random = makeRandom(seed)

  for (let index = 0; index < count; index += 1) {
    await postJournalEntry(
      generateCommand(random, entityId),
      { kind: 'script', id: 'generator', principalId: null },
      {
        dryRun: false,
        idempotencyKey: uuidv7(),
        requestId: null,
        ip: null,
        mayPostToSoftClosedPeriod: false,
      },
      { repository, clock },
    )
  }

  return repository
}

const SEEDS = [1, 7, 42, 1337, 99_991]

describe.each(SEEDS)('invariants over 60 random postings (seed %i)', (seed) => {
  it('every entry balances in every transaction currency', async () => {
    const repository = await postMany(seed, 60)
    expect(repository.entries).toHaveLength(60)

    for (const entry of repository.entries) {
      for (const [currency, difference] of balanceByCurrency(entry.lines)) {
        expect(difference, `${entry.id} in ${currency}`).toBe(0n)
      }
    }
  })

  it('every entry balances in the functional currency', async () => {
    // The one that actually catches FX rounding: converting each line
    // independently leaves this a cent out, and the database would reject it.
    const repository = await postMany(seed, 60)
    for (const entry of repository.entries) {
      expect(functionalBalance(entry.lines), entry.id).toBe(0n)
    }
  })

  it('the trial balance nets to zero', async () => {
    const repository = await postMany(seed, 60)

    const totals = new Map<string, { debit: bigint; credit: bigint }>()
    for (const entry of repository.entries) {
      for (const item of entry.lines) {
        const current = totals.get(item.accountNumber) ?? { debit: 0n, credit: 0n }
        current.debit += item.functionalDebit
        current.credit += item.functionalCredit
        totals.set(item.accountNumber, current)
      }
    }

    const rows: BalanceRow[] = [...totals].map(([accountNumber, total]) => ({
      accountId: accountNumber,
      accountNumber,
      accountName: accountNumber,
      accountType: 'asset' as const,
      normalBalance: 'debit' as const,
      rgsCode: null,
      openingDebit: 0n,
      openingCredit: 0n,
      periodDebit: total.debit,
      periodCredit: total.credit,
    }))

    const report = buildTrialBalance(
      {
        entityId: repository.entityId,
        currency: 'EUR',
        fiscalYearCode: '2026',
        fromPeriod: 1,
        toPeriod: 12,
        includeZeroRows: false,
      },
      rows,
    )

    expect(report.difference).toBe(0n)
    expect(report.totalDebit).toBe(report.totalCredit)
  })

  it('the hash chain verifies', async () => {
    const repository = await postMany(seed, 60)
    const result = verifyHashChain(repository.entries)
    expect(result.failures).toEqual([])
    expect(result.verified).toBe(true)
    expect(result.headHash).toBe(repository.entries.at(-1)?.hash)
  })

  it('tampering with any single entry is detected', async () => {
    const repository = await postMany(seed, 20)
    const entries = repository.entries

    for (let index = 0; index < entries.length; index += 1) {
      const tampered = [...entries]
      const victim = tampered[index]!
      // One cent. The smallest edit anyone would actually attempt.
      tampered[index] = {
        ...victim,
        lines: [
          { ...victim.lines[0]!, debit: victim.lines[0]!.debit + 1n },
          ...victim.lines.slice(1),
        ],
      }
      expect(verifyHashChain(tampered).verified, `entry ${String(index)}`).toBe(false)
    }
  })

  it('every posting emits exactly one audit record and one domain event', async () => {
    const repository = await postMany(seed, 60)
    expect(repository.audits).toHaveLength(60)
    expect(repository.events).toHaveLength(60)
    expect(new Set(repository.events.map((event) => event.type))).toEqual(
      new Set(['ledger.entry.posted']),
    )
  })
})

describe('uuidv7', () => {
  it('is monotonic within a millisecond', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7())
    expect([...ids].sort()).toEqual(ids)
  })

  it('has the right version and variant bits', () => {
    for (let index = 0; index < 200; index += 1) {
      const id = uuidv7()
      expect(id[14]).toBe('7')
      expect('89ab').toContain(id[19]!)
    }
  })

  it('does not collide', () => {
    expect(new Set(Array.from({ length: 20_000 }, () => uuidv7())).size).toBe(20_000)
  })
})
