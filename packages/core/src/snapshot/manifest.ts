import { createHash } from 'node:crypto'

/**
 * The sealed snapshot (spec 7.6).
 *
 * > "Periodic sealed snapshots: a scheduled XAF export plus a manifest of
 * > document hashes, written to the WORM bucket. This is your 'prove nothing
 * > changed' artefact."
 *
 * ## What "prove nothing changed" actually requires
 *
 * A snapshot that is only a copy proves very little: two copies that differ
 * tell you something changed and not which one is right. What makes an artefact
 * evidential is that it is **self-verifying and small**: a list of hashes, a
 * hash over the list, and the ledger's own chain head at the moment of sealing.
 *
 * The three parts answer three different questions, and none of them
 * substitutes for another:
 *
 *   - **The chain head** answers "have the postings changed". Every journal
 *     entry hashes its own canonical content plus its predecessor (spec 6.2), so
 *     one head hash covers the whole journal. An inspector who recorded the head
 *     in March can check it in September without reading a single entry.
 *   - **The document manifest** answers "are the source documents the same
 *     ones". The journal chain says nothing about the PDFs behind it; a manifest
 *     of content hashes does, and it also records what has since been deleted
 *     under the bewaarplicht — which is a fact about the administration rather
 *     than an absence.
 *   - **The XAF hash** answers "is the exported administration the same". The
 *     export is derived from the journal, so in principle the chain head covers
 *     it; in practice an exporter can change and the hash is what shows that it
 *     did. See the XAF bugs in ADR 0025.
 *
 * ## The seal is over the manifest, not over the data
 *
 * Sealing hashes the *canonical text of the manifest*, which is a few kilobytes
 * whatever the size of the administration. So a seal can be published, written
 * down, emailed to an accountant, put in a WORM bucket, or read out over the
 * phone — and any of those is enough to detect a change in seven years of
 * books.
 *
 * The canonical form is written out longhand for the same reason
 * `ledger/hash.ts` is: `JSON.stringify` does not promise key order, and a seal
 * that depends on the whim of a serialiser is not a seal.
 */

export const SNAPSHOT_FORMAT_VERSION = 'klopt.sealed-snapshot.v1'

export interface SnapshotDocument {
  readonly sha256: string
  readonly sizeBytes: number
  readonly retainUntil: string | null
  /** True when the bytes have been removed after their term ran out. */
  readonly deleted: boolean
}

export interface SnapshotInput {
  readonly entityId: string
  /** The book year this covers, e.g. `2026`. */
  readonly fiscalYear: string
  /** ISO 8601. Stamped by the caller, so a seal is reproducible from its own text. */
  readonly sealedAt: string
  /** The journal's hash-chain head, and how many entries it covers. */
  readonly chainHead: string | null
  readonly entryCount: number
  /** sha256 of the XAF as exported, and its declared line count. */
  readonly auditFileSha256: string
  readonly auditFileLineCount: number
  readonly documents: readonly SnapshotDocument[]
  /** The previous snapshot's seal, or null for the first. */
  readonly previousSeal: string | null
}

export interface SealedSnapshot extends SnapshotInput {
  /** The canonical text the seal is computed over. Kept, so a seal is checkable. */
  readonly manifest: string
  readonly seal: string
  readonly documentCount: number
  readonly deletedDocumentCount: number
  readonly totalBytes: bigint
}

/**
 * The placeholder for an absent value.
 *
 * Visible on purpose. A manifest is read by people as well as by hashes, and a
 * blank or a control character in the middle of a line is both unreadable and,
 * as this repository has now found out twice, a byte Postgres refuses outright.
 * A hyphen cannot be mistaken for a hash or a date.
 */
const ABSENT = '-'

const text = (value: string | null): string => value ?? ABSENT

/**
 * The manifest, as canonical text.
 *
 * One field per line, `key=value`, in a fixed order, with documents sorted by
 * hash. Sorted rather than in whatever order the database returned them: a
 * manifest whose seal depends on a query plan is not a seal either.
 */
function canonicalManifest(input: SnapshotInput): string {
  const lines: string[] = [
    `format=${SNAPSHOT_FORMAT_VERSION}`,
    `entity=${input.entityId}`,
    `fiscalYear=${input.fiscalYear}`,
    `sealedAt=${input.sealedAt}`,
    `previousSeal=${text(input.previousSeal)}`,
    `chainHead=${text(input.chainHead)}`,
    `entryCount=${String(input.entryCount)}`,
    `auditFile=${input.auditFileSha256}`,
    `auditFileLines=${String(input.auditFileLineCount)}`,
    `documentCount=${String(input.documents.length)}`,
  ]

  const sorted = [...input.documents].sort((a, b) => a.sha256.localeCompare(b.sha256))
  for (const document of sorted) {
    // A deleted document stays in the manifest. Its absence would read as "this
    // was never here", and what actually happened — kept for seven years, then
    // deliberately removed — is the fact worth being able to prove.
    lines.push(
      `document=${document.sha256} ${String(document.sizeBytes)} ${text(document.retainUntil)} ${document.deleted ? 'deleted' : 'present'}`,
    )
  }

  // A trailing newline, so appending a line cannot be mistaken for extending
  // the last one.
  return `${lines.join('\n')}\n`
}

export function sealSnapshot(input: SnapshotInput): SealedSnapshot {
  const manifest = canonicalManifest(input)

  return {
    ...input,
    manifest,
    seal: createHash('sha256').update(manifest, 'utf8').digest('hex'),
    documentCount: input.documents.length,
    deletedDocumentCount: input.documents.filter((document) => document.deleted).length,
    totalBytes: input.documents.reduce((sum, document) => sum + BigInt(document.sizeBytes), 0n),
  }
}

export type SnapshotDriftCode =
  | 'seal_broken'
  | 'chain_broken'
  | 'chain_head_changed'
  | 'entry_count_fell'
  | 'audit_file_changed'
  | 'document_missing'
  | 'document_changed'
  | 'document_undeleted'

export interface SnapshotDrift {
  readonly code: SnapshotDriftCode
  readonly detail: string
  readonly expected: string | null
  readonly actual: string | null
}

/**
 * Check a sealed snapshot against the administration as it is now.
 *
 * ## What counts as drift, and what does not
 *
 * An administration is expected to grow. New entries, new documents and a
 * moving chain head are all normal, so none of them is drift. What is drift is
 * anything that says the *past* is different from what was sealed:
 *
 *   - The seal not matching its own manifest. That is the snapshot being
 *     tampered with rather than the books, and it is checked first because
 *     every other comparison is against a manifest that has to be trustworthy.
 *   - The chain no longer verifying against itself. This is the check that
 *     catches content tampering, and it is *not* the same as the head having
 *     moved: the head is the last entry's **stored** hash, so somebody who
 *     rewrites a description and leaves the hash column alone changes the books
 *     and moves no head at all. Recomputing each entry's hash from its content
 *     is what notices. Found by a walk-through that rewrote a description and
 *     watched a comparison of heads say nothing.
 *   - The chain head having changed **for the same entry count**. That is the
 *     other half: somebody who rewrites an entry *and* its hash leaves a chain
 *     that verifies internally and no longer matches what was sealed. A longer
 *     chain with a different head is simply a chain that grew.
 *   - The entry count having *fallen*. Entries are append-only, so this cannot
 *     happen without something outside the application.
 *   - A document that was present and is now neither present nor recorded as
 *     deleted. Deleted-after-retention is expected and audited; simply gone is
 *     not.
 *   - A document reappearing after being sealed as deleted, which means either
 *     the deletion or the record of it is wrong.
 *
 * The XAF hash is reported as drift too, and it is the one that will fire
 * benignly — an improved exporter changes the bytes without changing the books.
 * It is still worth reporting, because the alternative is not noticing when the
 * exporter changes what it says about a closed year.
 */
export function verifySnapshot(
  snapshot: SealedSnapshot,
  now: {
    readonly chainHead: string | null
    readonly entryCount: number
    /**
     * Whether the chain still verifies against its own contents, and what
     * failed. Null when it was not checked — an expensive question, and one a
     * cheap verification is allowed to skip as long as it says so.
     */
    readonly chainVerified: boolean | null
    readonly chainFailures?: readonly string[] | undefined
    readonly auditFileSha256: string | null
    readonly documents: readonly SnapshotDocument[]
  },
): { readonly verified: boolean; readonly drift: readonly SnapshotDrift[] } {
  const drift: SnapshotDrift[] = []

  const recomputed = createHash('sha256').update(snapshot.manifest, 'utf8').digest('hex')
  if (recomputed !== snapshot.seal) {
    // Everything below compares against this manifest, so a broken seal is
    // reported alone rather than followed by conclusions drawn from it.
    return {
      verified: false,
      drift: [
        {
          code: 'seal_broken',
          detail: 'The manifest does not match its own seal, so this snapshot cannot be trusted.',
          expected: snapshot.seal,
          actual: recomputed,
        },
      ],
    }
  }

  if (now.chainVerified === false) {
    drift.push({
      code: 'chain_broken',
      detail: `The journal no longer verifies against its own hashes: ${(now.chainFailures ?? []).join(', ') || 'no reason given'}. An entry's content was changed without its hash, which a comparison of chain heads cannot see.`,
      expected: 'a chain that verifies',
      actual: 'a chain that does not',
    })
  }

  if (now.entryCount < snapshot.entryCount) {
    drift.push({
      code: 'entry_count_fell',
      detail:
        'There are fewer journal entries than when this was sealed. The journal is append-only.',
      expected: String(snapshot.entryCount),
      actual: String(now.entryCount),
    })
  }

  // Only comparable at equal length: a longer chain has a different head by
  // design, and calling that drift would make every snapshot fail by Tuesday.
  if (now.entryCount === snapshot.entryCount && now.chainHead !== snapshot.chainHead) {
    drift.push({
      code: 'chain_head_changed',
      detail: 'The chain head differs at the same entry count, which means an entry was rewritten.',
      expected: snapshot.chainHead,
      actual: now.chainHead,
    })
  }

  if (now.auditFileSha256 !== null && now.auditFileSha256 !== snapshot.auditFileSha256) {
    drift.push({
      code: 'audit_file_changed',
      detail:
        'The auditfile for this year exports to different bytes than when it was sealed. Usually a changed exporter rather than changed books — worth knowing either way.',
      expected: snapshot.auditFileSha256,
      actual: now.auditFileSha256,
    })
  }

  const byHash = new Map(now.documents.map((document) => [document.sha256, document]))

  for (const sealed of snapshot.documents) {
    const current = byHash.get(sealed.sha256)

    if (current === undefined) {
      drift.push({
        code: 'document_missing',
        detail: `Document ${sealed.sha256} was in this snapshot and is no longer recorded at all. A deletion under the bewaarplicht keeps its row; this does not.`,
        expected: sealed.sha256,
        actual: null,
      })
      continue
    }

    if (current.sizeBytes !== sealed.sizeBytes) {
      drift.push({
        code: 'document_changed',
        detail: `Document ${sealed.sha256} is recorded with a different size than when it was sealed.`,
        expected: String(sealed.sizeBytes),
        actual: String(current.sizeBytes),
      })
    }

    if (sealed.deleted && !current.deleted) {
      drift.push({
        code: 'document_undeleted',
        detail: `Document ${sealed.sha256} was sealed as deleted and is now recorded as present. Either the deletion or the record of it is wrong.`,
        expected: 'deleted',
        actual: 'present',
      })
    }
  }

  return { verified: drift.length === 0, drift }
}
