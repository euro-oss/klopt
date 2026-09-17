import { describe, expect, it } from 'vitest'
import {
  CANONICAL_FORMAT_VERSION,
  canonicalEntryContent,
  hashEntry,
  verifyHashChain,
} from '../../src/ledger/hash.js'
import type { PostedJournalEntry, PostedJournalLine } from '../../src/ledger/types.js'

function line(overrides: Partial<PostedJournalLine> = {}): PostedJournalLine {
  return {
    id: 'line-1',
    lineNumber: 1,
    accountId: 'acc-1',
    accountNumber: '1100',
    description: null,
    debit: 100_00n,
    credit: 0n,
    currency: 'EUR',
    functionalDebit: 100_00n,
    functionalCredit: 0n,
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

function entry(overrides: Partial<PostedJournalEntry> = {}): PostedJournalEntry {
  const base: Omit<PostedJournalEntry, 'hash'> = {
    id: 'entry-1',
    entityId: 'entity-1',
    journalId: 'journal-1',
    journalCode: 'MEM',
    fiscalYearId: 'fy-1',
    fiscalYearCode: '2026',
    periodId: 'period-3',
    periodSequence: 3,
    entryNumber: 1,
    chainSequence: 1n,
    bookingDate: '2026-03-15',
    documentDate: '2026-03-15',
    description: 'Test',
    sourceDocumentRef: null,
    reversesEntryId: null,
    functionalCurrency: 'EUR',
    createdAt: '2026-03-15T10:00:00.000Z',
    actor: { kind: 'human', id: 'user-1', principalId: null },
    previousHash: null,
    lines: [
      line(),
      line({
        id: 'line-2',
        lineNumber: 2,
        debit: 0n,
        credit: 100_00n,
        functionalDebit: 0n,
        functionalCredit: 100_00n,
        accountNumber: '8000',
      }),
    ],
    ...overrides,
  }
  return { ...base, hash: hashEntry(base) }
}

describe('canonical form', () => {
  it('is versioned by its first line', () => {
    expect(canonicalEntryContent(entry()).split('\n')[0]).toBe(CANONICAL_FORMAT_VERSION)
  })

  it('does not depend on the order lines happen to arrive in', () => {
    const forwards = entry()
    const backwards = entry({ lines: [...forwards.lines].reverse() })
    expect(backwards.hash).toBe(forwards.hash)
  })

  it('does not depend on the order dimensions arrive in', () => {
    const a = entry({
      lines: [
        line({
          dimensions: [
            { typeId: 't1', typeCode: 'REGION', valueId: 'v1', valueCode: 'NOORD' },
            { typeId: 't2', typeCode: 'VEHICLE', valueId: 'v2', valueCode: 'VAN-01' },
          ],
        }),
        line({
          id: 'line-2',
          lineNumber: 2,
          debit: 0n,
          credit: 100_00n,
          functionalDebit: 0n,
          functionalCredit: 100_00n,
        }),
      ],
    })
    const b = entry({
      lines: [
        line({
          dimensions: [
            { typeId: 't2', typeCode: 'VEHICLE', valueId: 'v2', valueCode: 'VAN-01' },
            { typeId: 't1', typeCode: 'REGION', valueId: 'v1', valueCode: 'NOORD' },
          ],
        }),
        line({
          id: 'line-2',
          lineNumber: 2,
          debit: 0n,
          credit: 100_00n,
          functionalDebit: 0n,
          functionalCredit: 100_00n,
        }),
      ],
    })
    expect(a.hash).toBe(b.hash)
  })

  it('distinguishes an absent value from an empty one', () => {
    const absent = entry({ sourceDocumentRef: null })
    const empty = entry({ sourceDocumentRef: '' })
    expect(absent.hash).not.toBe(empty.hash)
  })

  it('escapes strings, so a description cannot forge a field', () => {
    // Without escaping, this description would inject a `description=` line and
    // two entries with different content could hash the same.
    const injected = entry({ description: 'x\nsourceDocumentRef="forged"' })
    const plain = entry({ description: 'x' })
    expect(injected.hash).not.toBe(plain.hash)
    expect(canonicalEntryContent(injected)).toContain('\\n')
  })

  it.each([
    ['entityId', { entityId: 'other' }],
    ['chainSequence', { chainSequence: 2n }],
    ['bookingDate', { bookingDate: '2026-03-16' }],
    ['documentDate', { documentDate: '2026-03-16' }],
    ['description', { description: 'Changed' }],
    ['entryNumber', { entryNumber: 2 }],
    ['journalCode', { journalCode: 'VRK' }],
    ['periodSequence', { periodSequence: 4 }],
    ['createdAt', { createdAt: '2026-03-15T10:00:00.001Z' }],
    ['previousHash', { previousHash: 'a'.repeat(64) }],
    ['reversesEntryId', { reversesEntryId: 'entry-0' }],
    ['functionalCurrency', { functionalCurrency: 'USD' }],
  ])('changes when %s changes', (_field, override) => {
    expect(entry(override as Partial<PostedJournalEntry>).hash).not.toBe(entry().hash)
  })

  it.each([
    ['amount', { debit: 100_01n }],
    ['account', { accountNumber: '1101' }],
    ['currency', { currency: 'USD' }],
    ['functional amount', { functionalDebit: 100_01n }],
    ['tax code', { taxCode: 'H21' }],
    ['subledger', { subledgerKind: 'customer' as const, subledgerId: 'cust-1' }],
    [
      'dimensions',
      { dimensions: [{ typeId: 't', typeCode: 'REGION', valueId: 'v', valueCode: 'ZUID' }] },
    ],
  ])('changes when a line %s changes', (_field, override) => {
    const tampered = entry({
      lines: [
        line(override),
        line({
          id: 'line-2',
          lineNumber: 2,
          debit: 0n,
          credit: 100_00n,
          functionalDebit: 0n,
          functionalCredit: 100_00n,
          accountNumber: '8000',
        }),
      ],
    })
    expect(tampered.hash).not.toBe(entry().hash)
  })

  it('ignores the internal line id, which is not accounting content', () => {
    const renamed = entry({
      lines: [
        line({ id: 'a-different-uuid' }),
        line({
          id: 'line-2',
          lineNumber: 2,
          debit: 0n,
          credit: 100_00n,
          functionalDebit: 0n,
          functionalCredit: 100_00n,
          accountNumber: '8000',
        }),
      ],
    })
    expect(renamed.hash).toBe(entry().hash)
  })
})

/** Build a valid chain of `count` entries. */
function chain(count: number): PostedJournalEntry[] {
  const entries: PostedJournalEntry[] = []
  let previousHash: string | null = null

  for (let index = 1; index <= count; index += 1) {
    const built = entry({
      id: `entry-${String(index)}`,
      chainSequence: BigInt(index),
      entryNumber: index,
      description: `Entry ${String(index)}`,
      previousHash,
    })
    entries.push(built)
    previousHash = built.hash
  }

  return entries
}

describe('chain verification', () => {
  it('verifies a well-formed chain and reports its head', () => {
    const entries = chain(5)
    const result = verifyHashChain(entries)

    expect(result.verified).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.entryCount).toBe(5)
    expect(result.headHash).toBe(entries[4]?.hash)
  })

  it('verifies an empty chain, with no head', () => {
    expect(verifyHashChain([])).toEqual({
      verified: true,
      entryCount: 0,
      headHash: null,
      failures: [],
    })
  })

  it('catches an edited entry, and blames only that entry', () => {
    const entries = chain(5)
    // Rewrite the content but leave the stored hash: exactly what someone
    // editing the database directly would produce.
    entries[2] = { ...entries[2]!, description: 'Tampered' }

    const result = verifyHashChain(entries)

    expect(result.verified).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({
      entryId: 'entry-3',
      reason: 'content_hash_mismatch',
    })
  })

  it('catches a spliced-out entry', () => {
    const entries = chain(5)
    entries.splice(2, 1)

    const result = verifyHashChain(entries)
    const reasons = result.failures.map((failure) => failure.reason)

    expect(result.verified).toBe(false)
    expect(reasons).toContain('sequence_gap')
    expect(reasons).toContain('previous_hash_mismatch')
  })

  it('catches a reordered chain', () => {
    const entries = chain(4)
    const swapped = [entries[0]!, entries[2]!, entries[1]!, entries[3]!]

    expect(verifyHashChain(swapped).verified).toBe(false)
  })

  it('reports one break, not one per entry after it', () => {
    // A naive verifier that follows its own recomputed hash would flag every
    // subsequent entry. An auditor needs to see where the damage stops.
    const entries = chain(6)
    entries[1] = { ...entries[1]!, description: 'Tampered' }

    const result = verifyHashChain(entries)
    expect(result.failures).toHaveLength(1)
  })
})
