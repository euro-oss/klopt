import { createHash } from 'node:crypto'
import type { PostedJournalEntry, PostedJournalLine } from './types.js'

/**
 * The hash chain (spec 6.2).
 *
 * Each entry hashes its own canonical content together with the previous
 * entry's hash, per entity. Publishing the head hash turns "trust us" into
 * "verify us" for an inspector: they recompute the chain from an export and
 * compare.
 *
 * The canonical form is a line-based text format rather than JSON, for three
 * reasons. It is stable — field order is fixed by the code below, not by an
 * object literal's insertion order. It is diffable, so when a chain fails to
 * verify a human can see which field moved. And it is reimplementable: an
 * auditor's script should be able to reproduce it from the specification in
 * this file without running our code.
 *
 * Every string value is JSON-escaped, which makes newlines and `=` inside a
 * description unambiguous. Absent values are the literal `null`, never an
 * omitted line, so that "no source document" and "source document deleted"
 * cannot hash the same.
 *
 * # Versioning
 *
 * The format is versioned by its first line. Changing the canonical form
 * invalidates every stored hash, so it is a new version plus a documented
 * rehash-and-attest migration, never an edit to this function.
 *
 * ## v2
 *
 * Added `line.taxRole` (migration 0012). Before 1.0 the format is not yet
 * frozen, so migration 0012 refuses to run on a database that already has
 * journal entries rather than shipping a rehash procedure: rehashing means
 * rewriting `journal_entries.hash`, and the append-only trigger that forbids
 * that is worth more than the convenience of an in-place upgrade. After 1.0 a
 * further version needs the rehash-and-attest procedure, which must verify the
 * existing chain before it rewrites anything -- otherwise it launders a chain
 * that was already broken.
 */
export const CANONICAL_FORMAT_VERSION = 'klopt.journal-entry.v2'

function text(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value)
}

function amount(value: bigint | null): string {
  return value === null ? 'null' : value.toString()
}

function canonicalLine(line: PostedJournalLine, index: number): string[] {
  const prefix = `line.${String(index)}`
  const dimensions = [...line.dimensions]
    .sort((a, b) => a.typeCode.localeCompare(b.typeCode))
    .map((dimension) => `${prefix}.dimension.${dimension.typeCode}=${text(dimension.valueCode)}`)

  return [
    `${prefix}.number=${String(line.lineNumber)}`,
    `${prefix}.account=${text(line.accountNumber)}`,
    `${prefix}.description=${text(line.description)}`,
    `${prefix}.debit=${amount(line.debit)}`,
    `${prefix}.credit=${amount(line.credit)}`,
    `${prefix}.currency=${text(line.currency)}`,
    `${prefix}.functionalDebit=${amount(line.functionalDebit)}`,
    `${prefix}.functionalCredit=${amount(line.functionalCredit)}`,
    `${prefix}.exchangeRate=${text(line.exchangeRate)}`,
    `${prefix}.exchangeRateSource=${text(line.exchangeRateSource)}`,
    `${prefix}.taxCode=${text(line.taxCode)}`,
    // v2. Without this, flipping a line from base to tax leaves the chain
    // verifying while the BTW-aangifte changes -- and the return is derived
    // from the journal, so that is a hole in exactly the guarantee the chain
    // exists to give.
    `${prefix}.taxRole=${text(line.taxRole)}`,
    `${prefix}.taxAmount=${amount(line.taxAmount)}`,
    `${prefix}.subledgerKind=${text(line.subledgerKind)}`,
    `${prefix}.subledgerId=${text(line.subledgerId)}`,
    `${prefix}.dimensions=${String(dimensions.length)}`,
    ...dimensions,
  ]
}

/** The exact bytes that get hashed. Exposed so that a mismatch is debuggable. */
export function canonicalEntryContent(
  entry: Omit<PostedJournalEntry, 'hash'> & { readonly hash?: string },
): string {
  const lines = [...entry.lines].sort((a, b) => a.lineNumber - b.lineNumber)

  return [
    CANONICAL_FORMAT_VERSION,
    `previousHash=${text(entry.previousHash)}`,
    `entity=${text(entry.entityId)}`,
    `chainSequence=${entry.chainSequence.toString()}`,
    `journal=${text(entry.journalCode)}`,
    `entryNumber=${String(entry.entryNumber)}`,
    `fiscalYear=${text(entry.fiscalYearCode)}`,
    `period=${String(entry.periodSequence)}`,
    `bookingDate=${text(entry.bookingDate)}`,
    `documentDate=${text(entry.documentDate)}`,
    `description=${text(entry.description)}`,
    `sourceDocumentRef=${text(entry.sourceDocumentRef)}`,
    `reversesEntryId=${text(entry.reversesEntryId)}`,
    `functionalCurrency=${text(entry.functionalCurrency)}`,
    `createdAt=${text(entry.createdAt)}`,
    `actorKind=${text(entry.actor.kind)}`,
    `actorId=${text(entry.actor.id)}`,
    `actorPrincipalId=${text(entry.actor.principalId)}`,
    `lines=${String(lines.length)}`,
    ...lines.flatMap((line, index) => canonicalLine(line, index + 1)),
    '',
  ].join('\n')
}

export function hashEntry(
  entry: Omit<PostedJournalEntry, 'hash'> & { readonly hash?: string },
): string {
  return createHash('sha256').update(canonicalEntryContent(entry), 'utf8').digest('hex')
}

export interface ChainVerificationFailure {
  readonly entryId: string
  readonly chainSequence: bigint
  readonly reason: 'content_hash_mismatch' | 'previous_hash_mismatch' | 'sequence_gap'
  readonly expected: string
  readonly actual: string
}

export interface ChainVerificationResult {
  readonly verified: boolean
  readonly entryCount: number
  /** The chain's tip. This is what gets published for an inspector to check. */
  readonly headHash: string | null
  readonly failures: readonly ChainVerificationFailure[]
}

/**
 * Recompute a chain and report every break, not just the first — a single
 * tampered entry breaks its own content hash and every subsequent link, and an
 * auditor wants to see that the damage stops somewhere.
 *
 * `entries` must be every entry for one entity, ascending by chain sequence.
 */
export function verifyHashChain(entries: readonly PostedJournalEntry[]): ChainVerificationResult {
  const failures: ChainVerificationFailure[] = []
  let expectedPrevious: string | null = null
  let expectedSequence: bigint | null = null

  for (const entry of entries) {
    if (expectedSequence !== null && entry.chainSequence !== expectedSequence) {
      failures.push({
        entryId: entry.id,
        chainSequence: entry.chainSequence,
        reason: 'sequence_gap',
        expected: expectedSequence.toString(),
        actual: entry.chainSequence.toString(),
      })
    }

    if (entry.previousHash !== expectedPrevious) {
      failures.push({
        entryId: entry.id,
        chainSequence: entry.chainSequence,
        reason: 'previous_hash_mismatch',
        expected: expectedPrevious ?? 'null',
        actual: entry.previousHash ?? 'null',
      })
    }

    const recomputed = hashEntry(entry)
    if (recomputed !== entry.hash) {
      failures.push({
        entryId: entry.id,
        chainSequence: entry.chainSequence,
        reason: 'content_hash_mismatch',
        expected: recomputed,
        actual: entry.hash,
      })
    }

    // Follow what is stored, not what we recomputed, so one bad entry does not
    // cascade into a "previous_hash_mismatch" on every entry after it.
    expectedPrevious = entry.hash
    expectedSequence = entry.chainSequence + 1n
  }

  const last = entries.at(-1)
  return {
    verified: failures.length === 0,
    entryCount: entries.length,
    headHash: last?.hash ?? null,
    failures,
  }
}
