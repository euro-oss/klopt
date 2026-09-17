import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LedgerError,
  buildReversal,
  postJournalEntry,
  systemClock,
  verifyHashChain,
  type Actor,
  type JournalLineInput,
  type PostJournalEntryCommand,
  type PostJournalEntryOptions,
} from '@klopt/core'
import { uuidv7 } from '@klopt/core'
import { withLedger } from '../src/unit-of-work.js'
import { createFixture, type Fixture } from './support/fixture.js'

/**
 * The posting API against a real Postgres. The pure rules are tested in
 * @klopt/core; what is being tested here is that the rules, the triggers and
 * the transaction boundary agree with each other.
 */

const bookkeeper: Actor = { kind: 'human', id: 'user_1', principalId: null }

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

function command(
  entityId: string,
  overrides: Partial<PostJournalEntryCommand> = {},
): PostJournalEntryCommand {
  return {
    entityId,
    journalCode: 'MEM',
    bookingDate: '2026-03-15',
    documentDate: '2026-03-15',
    description: 'Test entry',
    sourceDocumentRef: null,
    reversesEntryId: null,
    lines: [
      line({ accountNumber: '1100', debit: 121_00n }),
      line({ accountNumber: '8000', credit: 100_00n }),
      line({ accountNumber: '1500', credit: 21_00n }),
    ],
    ...overrides,
  }
}

function options(overrides: Partial<PostJournalEntryOptions> = {}): PostJournalEntryOptions {
  return {
    dryRun: false,
    idempotencyKey: uuidv7(),
    requestId: null,
    ip: null,
    mayPostToSoftClosedPeriod: false,
    ...overrides,
  }
}

let fixture: Fixture

beforeAll(async () => {
  fixture = await createFixture()
}, 60_000)

afterAll(async () => {
  await fixture.close()
})

async function post(
  cmd: PostJournalEntryCommand,
  opts: PostJournalEntryOptions = options(),
  actor: Actor = bookkeeper,
) {
  return withLedger(fixture.database, (repository) =>
    postJournalEntry(cmd, actor, opts, { repository, clock: systemClock }),
  )
}

describe('posting a journal entry', () => {
  it('writes the entry, its lines and its balances', async () => {
    const result = await post(command(fixture.entityId))

    expect(result.replayed).toBe(false)
    expect(result.entry.entryNumber).toBeGreaterThan(0)
    expect(result.entry.chainSequence).toBeGreaterThan(0n)
    expect(result.entry.lines).toHaveLength(3)
    expect(result.entry.hash).toMatch(/^[0-9a-f]{64}$/)

    const reloaded = await withLedger(fixture.database, (repository) =>
      repository.findEntryById(fixture.entityId, result.entry.id),
    )
    expect(reloaded).not.toBeNull()
    expect(reloaded).toEqual(result.entry)
  })

  it('resolves the booking date to its period', async () => {
    const result = await post(command(fixture.entityId, { bookingDate: '2026-07-04' }))
    expect(result.entry.periodSequence).toBe(7)
    expect(result.entry.fiscalYearCode).toBe('2026')
  })

  it('numbers gaplessly per journal per year', async () => {
    const entity = await createFixture()
    try {
      const first = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )
      const second = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )

      expect(first.entry.entryNumber).toBe(1)
      expect(second.entry.entryNumber).toBe(2)

      // A different journal has its own series.
      const sales = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId, { journalCode: 'VRK' }), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )
      expect(sales.entry.entryNumber).toBe(1)
    } finally {
      await entity.close()
    }
  })

  it('does not burn a number when the transaction rolls back', async () => {
    const entity = await createFixture()
    try {
      const first = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )
      expect(first.entry.entryNumber).toBe(1)

      // Roll back after allocating: a Postgres sequence would have burned 2.
      await expect(
        withLedger(entity.database, async (repository) => {
          await postJournalEntry(command(entity.entityId), bookkeeper, options(), {
            repository,
            clock: systemClock,
          })
          throw new Error('deliberate rollback')
        }),
      ).rejects.toThrow('deliberate rollback')

      const third = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )
      expect(third.entry.entryNumber).toBe(2)
    } finally {
      await entity.close()
    }
  })

  it('is idempotent: the same key returns the first result and writes nothing', async () => {
    const key = uuidv7()
    const cmd = command(fixture.entityId)

    const first = await post(cmd, options({ idempotencyKey: key }))
    const second = await post(cmd, options({ idempotencyKey: key }))

    expect(second.replayed).toBe(true)
    expect(second.entry.id).toBe(first.entry.id)
    expect(second.entry.chainSequence).toBe(first.entry.chainSequence)
  })

  it('rejects a key reused for a different body', async () => {
    const key = uuidv7()
    await post(command(fixture.entityId), options({ idempotencyKey: key }))

    await expect(
      post(
        command(fixture.entityId, { description: 'Something else entirely' }),
        options({ idempotencyKey: key }),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_key_reused' })
  })

  it('commits nothing on a dry run', async () => {
    const entity = await createFixture()
    try {
      const result = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options({ dryRun: true }), {
          repository,
          clock: systemClock,
        }),
      )

      expect(result.dryRun).toBe(true)
      expect(result.entry.lines).toHaveLength(3)

      const found = await withLedger(entity.database, (repository) =>
        repository.findEntryById(entity.entityId, result.entry.id),
      )
      expect(found).toBeNull()

      // And the numbering was not touched.
      const real = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )
      expect(real.entry.entryNumber).toBe(1)
      expect(real.entry.chainSequence).toBe(1n)
    } finally {
      await entity.close()
    }
  })
})

describe('validation', () => {
  it('refuses an unbalanced entry', async () => {
    await expect(
      post(
        command(fixture.entityId, {
          lines: [
            line({ accountNumber: '1100', debit: 100_00n }),
            line({ accountNumber: '8000', credit: 99_00n }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'entry_unbalanced' })
  })

  it('refuses a single-line entry', async () => {
    await expect(
      post(command(fixture.entityId, { lines: [line({ accountNumber: '1100', debit: 100_00n })] })),
    ).rejects.toMatchObject({ code: 'entry_too_few_lines' })
  })

  it('refuses a blocked account', async () => {
    await expect(
      post(
        command(fixture.entityId, {
          lines: [
            line({ accountNumber: '9999', debit: 100_00n }),
            line({ accountNumber: '1100', credit: 100_00n }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'account_blocked' })
  })

  it('refuses a booking date with no period', async () => {
    await expect(
      post(command(fixture.entityId, { bookingDate: '2019-01-01' })),
    ).rejects.toMatchObject({ code: 'no_period_for_date' })
  })

  it('reports every violation at once, not just the first', async () => {
    const error = await post(
      command(fixture.entityId, {
        journalCode: 'NOPE',
        lines: [
          line({ accountNumber: 'ZZZZ', debit: 100_00n }),
          line({ accountNumber: '1100', credit: 100_00n, debit: 5_00n }),
        ],
      }),
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(LedgerError)
    const codes = new Set((error as LedgerError).violations.map((item) => item.code))
    expect(codes).toContain('unknown_journal')
    expect(codes).toContain('unknown_account')
    expect(codes).toContain('line_debit_and_credit')
  })

  it('enforces a required dimension', async () => {
    await expect(
      post(
        command(fixture.entityId, {
          lines: [
            line({ accountNumber: '4300', debit: 50_00n }),
            line({ accountNumber: '1100', credit: 50_00n }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'missing_required_dimension' })
  })

  it('accepts the same posting once the dimension is supplied', async () => {
    const result = await post(
      command(fixture.entityId, {
        lines: [
          line({
            accountNumber: '4300',
            debit: 50_00n,
            dimensions: [
              { typeCode: 'VEHICLE', valueCode: 'VAN-01' },
              { typeCode: 'REGION', valueCode: 'NOORD' },
            ],
          }),
          line({ accountNumber: '1100', credit: 50_00n }),
        ],
      }),
    )

    expect(result.entry.lines[0]?.dimensions.map((d) => d.valueCode).sort()).toEqual([
      'NOORD',
      'VAN-01',
    ])
  })

  it('refuses a blocked dimension value', async () => {
    await expect(
      post(
        command(fixture.entityId, {
          lines: [
            line({
              accountNumber: '4300',
              debit: 50_00n,
              dimensions: [{ typeCode: 'VEHICLE', valueCode: 'VAN-OLD' }],
            }),
            line({ accountNumber: '1100', credit: 50_00n }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'dimension_value_blocked' })
  })
})

describe('foreign currency', () => {
  it('stores both original and functional amounts', async () => {
    const result = await post(
      command(fixture.entityId, {
        lines: [
          line({
            accountNumber: '1100',
            debit: 1000_00n,
            currency: 'USD',
            exchangeRate: '0.92',
            exchangeRateSource: 'ECB 2026-03-15',
          }),
          line({
            accountNumber: '8000',
            credit: 1000_00n,
            currency: 'USD',
            exchangeRate: '0.92',
            exchangeRateSource: 'ECB 2026-03-15',
          }),
        ],
      }),
    )

    expect(result.entry.lines[0]?.functionalDebit).toBe(92_000n)
    expect(result.entry.lines[1]?.functionalCredit).toBe(92_000n)

    // The rate must survive a Postgres numeric round trip, or the hash breaks.
    const reloaded = await withLedger(fixture.database, (repository) =>
      repository.findEntryById(fixture.entityId, result.entry.id),
    )
    expect(reloaded?.lines[0]?.exchangeRate).toBe('0.92')
    expect(reloaded?.hash).toBe(result.entry.hash)
  })

  it('requires a rate on a foreign line and refuses one on a functional line', async () => {
    await expect(
      post(
        command(fixture.entityId, {
          lines: [
            line({ accountNumber: '1100', debit: 100_00n, currency: 'USD' }),
            line({ accountNumber: '8000', credit: 100_00n, currency: 'USD' }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'missing_exchange_rate' })

    await expect(
      post(
        command(fixture.entityId, {
          lines: [
            line({
              accountNumber: '1100',
              debit: 100_00n,
              currency: 'EUR',
              exchangeRate: '1.0',
              exchangeRateSource: 'nonsense',
            }),
            line({ accountNumber: '8000', credit: 100_00n }),
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'unexpected_exchange_rate' })
  })
})

describe('reversals', () => {
  it('reverses an entry, and the pair nets to zero', async () => {
    const entity = await createFixture()
    try {
      const original = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )

      const reversal = await withLedger(entity.database, (repository) =>
        postJournalEntry(
          buildReversal(original.entry, { bookingDate: '2026-03-31', description: null }),
          bookkeeper,
          options(),
          { repository, clock: systemClock },
        ),
      )

      expect(reversal.entry.reversesEntryId).toBe(original.entry.id)
      expect(reversal.entry.lines[0]?.credit).toBe(original.entry.lines[0]?.debit)

      const net = [...original.entry.lines, ...reversal.entry.lines].reduce(
        (total, item) => total + item.functionalDebit - item.functionalCredit,
        0n,
      )
      expect(net).toBe(0n)
    } finally {
      await entity.close()
    }
  })

  it('refuses to reverse the same entry twice', async () => {
    const entity = await createFixture()
    try {
      const original = await withLedger(entity.database, (repository) =>
        postJournalEntry(command(entity.entityId), bookkeeper, options(), {
          repository,
          clock: systemClock,
        }),
      )
      const reversal = buildReversal(original.entry, {
        bookingDate: '2026-03-31',
        description: null,
      })

      await withLedger(entity.database, (repository) =>
        postJournalEntry(reversal, bookkeeper, options(), { repository, clock: systemClock }),
      )

      await expect(
        withLedger(entity.database, (repository) =>
          postJournalEntry(reversal, bookkeeper, options(), { repository, clock: systemClock }),
        ),
      ).rejects.toMatchObject({ code: 'reversal_target_already_reversed' })
    } finally {
      await entity.close()
    }
  })
})

describe('the hash chain', () => {
  it('verifies over a sequence of postings', async () => {
    const entity = await createFixture()
    try {
      for (let index = 0; index < 5; index += 1) {
        await withLedger(entity.database, (repository) =>
          postJournalEntry(
            command(entity.entityId, { description: `Entry ${String(index)}` }),
            bookkeeper,
            options(),
            { repository, clock: systemClock },
          ),
        )
      }

      const chain = await withLedger(entity.database, (repository) =>
        repository.loadChain(entity.entityId),
      )

      const result = verifyHashChain(chain)
      expect(result.failures).toEqual([])
      expect(result.verified).toBe(true)
      expect(result.entryCount).toBe(5)
      expect(result.headHash).toBe(chain.at(-1)?.hash)

      expect(chain.map((entry) => entry.chainSequence)).toEqual([1n, 2n, 3n, 4n, 5n])
      expect(chain[0]?.previousHash).toBeNull()
      expect(chain[1]?.previousHash).toBe(chain[0]?.hash)
    } finally {
      await entity.close()
    }
  })
})
