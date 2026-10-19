import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import { postJournalEntry } from '../../src/ledger/posting.js'
import type { JournalLineInput } from '../../src/ledger/types.js'
import { uuidv7 } from '../../src/ids.js'
import { FakeLedgerRepository, fakeClock } from '../support/fake-repository.js'

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

describe('period lock violation detail', () => {
  it('carries startsOn, endsOn and yearStatus on a hard-closed refusal', async () => {
    const entityId = uuidv7()
    const repository = new FakeLedgerRepository(entityId)
    repository.periodStatus = 'hard_closed'
    repository.fiscalYearStatus = 'open'

    let caught: unknown
    try {
      await postJournalEntry(
        {
          entityId,
          journalCode: 'MEM',
          bookingDate: '2026-03-15',
          documentDate: '2026-03-15',
          description: 'Into a closed period',
          sourceDocumentRef: null,
          reversesEntryId: null,
          lines: [
            line({ accountNumber: '1100', debit: 100_00n }),
            line({ accountNumber: '8000', credit: 100_00n }),
          ],
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
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(LedgerError)
    const error = caught as LedgerError
    expect(error.code).toBe('period_hard_closed')
    expect(error.violations[0]?.detail).toEqual({
      period: '3',
      fiscalYear: '2026',
      startsOn: '2026-03-01',
      endsOn: '2026-03-28',
      yearStatus: 'open',
    })
  })
})
