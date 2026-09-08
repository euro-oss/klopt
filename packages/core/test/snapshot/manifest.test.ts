import { describe, expect, it } from 'vitest'
import { sealSnapshot, verifySnapshot, type SnapshotInput } from '../../src/index.js'

/**
 * The "prove nothing changed" artefact.
 *
 * The cases that matter are the ones that separate *growth* from *drift*. An
 * administration is expected to gain entries and documents; a snapshot that
 * called that tampering would fail by Tuesday and be switched off by Wednesday.
 */

const input = (overrides: Partial<SnapshotInput> = {}): SnapshotInput => ({
  entityId: 'entity-1',
  fiscalYear: '2026',
  sealedAt: '2027-01-05T09:00:00.000Z',
  chainHead: 'a'.repeat(64),
  entryCount: 120,
  auditFileSha256: 'b'.repeat(64),
  auditFileLineCount: 480,
  documents: [
    { sha256: 'c'.repeat(64), sizeBytes: 1_000, retainUntil: '2033-12-31', deleted: false },
    { sha256: 'd'.repeat(64), sizeBytes: 2_000, retainUntil: '2033-12-31', deleted: false },
  ],
  previousSeal: null,
  ...overrides,
})

const now = (overrides: Partial<Parameters<typeof verifySnapshot>[1]> = {}) => ({
  chainHead: 'a'.repeat(64),
  entryCount: 120,
  chainVerified: true,
  auditFileSha256: 'b'.repeat(64),
  documents: input().documents,
  ...overrides,
})

describe('sealing', () => {
  it('produces the same seal for the same facts, whatever order they arrive in', () => {
    // The seal is over canonical text, and a manifest whose hash depends on a
    // query plan is not a seal.
    const one = sealSnapshot(input())
    const two = sealSnapshot(input({ documents: [...input().documents].reverse() }))

    expect(two.seal).toBe(one.seal)
    expect(two.manifest).toBe(one.manifest)
  })

  it('changes when any fact changes', () => {
    const base = sealSnapshot(input()).seal

    expect(sealSnapshot(input({ chainHead: 'e'.repeat(64) })).seal).not.toBe(base)
    expect(sealSnapshot(input({ entryCount: 121 })).seal).not.toBe(base)
    expect(sealSnapshot(input({ auditFileSha256: 'f'.repeat(64) })).seal).not.toBe(base)
    expect(sealSnapshot(input({ sealedAt: '2027-01-06T09:00:00.000Z' })).seal).not.toBe(base)
    expect(sealSnapshot(input({ previousSeal: '9'.repeat(64) })).seal).not.toBe(base)
  })

  it('changes when a document is added, removed or resized', () => {
    const base = sealSnapshot(input()).seal
    const documents = input().documents

    expect(sealSnapshot(input({ documents: [documents[0]!] })).seal).not.toBe(base)
    expect(
      sealSnapshot(
        input({
          documents: [documents[0]!, { ...documents[1]!, sizeBytes: 2_001 }],
        }),
      ).seal,
    ).not.toBe(base)
  })

  it('keeps a deleted document in the manifest', () => {
    // Its absence would read as "this was never here". What happened — kept for
    // seven years, then deliberately removed — is the fact worth proving.
    const sealed = sealSnapshot(
      input({
        documents: [
          { sha256: 'c'.repeat(64), sizeBytes: 1_000, retainUntil: '2033-12-31', deleted: true },
        ],
      }),
    )

    expect(sealed.manifest).toContain(`document=${'c'.repeat(64)} 1000 2033-12-31 deleted`)
    expect(sealed.documentCount).toBe(1)
    expect(sealed.deletedDocumentCount).toBe(1)
  })

  it('counts the bytes it covers', () => {
    expect(sealSnapshot(input()).totalBytes).toBe(3_000n)
  })

  it('names its format, so a future reader knows what it is holding', () => {
    expect(sealSnapshot(input()).manifest.startsWith('format=klopt.sealed-snapshot.v1\n')).toBe(
      true,
    )
  })
})

describe('verifying', () => {
  it('passes when nothing has changed', () => {
    const sealed = sealSnapshot(input())
    expect(verifySnapshot(sealed, now()).verified).toBe(true)
  })

  it('passes when the administration has simply grown', () => {
    // The whole design rests on this. New entries move the chain head, and a
    // snapshot that called that drift would be useless.
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(
      sealed,
      now({
        chainHead: 'z'.repeat(64),
        entryCount: 200,
        documents: [
          ...input().documents,
          { sha256: '1'.repeat(64), sizeBytes: 500, retainUntil: '2034-12-31', deleted: false },
        ],
      }),
    )

    expect(result.verified).toBe(true)
    expect(result.drift).toEqual([])
  })

  it('reports a chain that no longer verifies against its own hashes', () => {
    // The check that catches content tampering. Rewriting a description and
    // leaving the hash column alone changes the books and moves no head at
    // all — a comparison of heads says nothing, and this is what notices.
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(
      sealed,
      now({ chainVerified: false, chainFailures: ['hash_mismatch'] }),
    )

    expect(result.verified).toBe(false)
    expect(result.drift.map((entry) => entry.code)).toEqual(['chain_broken'])
    expect(result.drift[0]?.detail).toContain('hash_mismatch')
  })

  it('says nothing about the chain when it was not checked', () => {
    const sealed = sealSnapshot(input())
    expect(verifySnapshot(sealed, now({ chainVerified: null })).verified).toBe(true)
  })

  it('reports a rewritten entry: same length, different head', () => {
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(sealed, now({ chainHead: 'z'.repeat(64) }))

    expect(result.verified).toBe(false)
    expect(result.drift.map((entry) => entry.code)).toEqual(['chain_head_changed'])
  })

  it('reports a journal that got shorter', () => {
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(sealed, now({ entryCount: 119, chainHead: 'z'.repeat(64) }))

    expect(result.drift.map((entry) => entry.code)).toContain('entry_count_fell')
  })

  it('reports a tampered manifest first, and says nothing else', () => {
    // Every other comparison is against this manifest, so conclusions drawn
    // from a broken one would be worse than no conclusions.
    const sealed = sealSnapshot(input())
    const tampered = {
      ...sealed,
      manifest: sealed.manifest.replace('entryCount=120', 'entryCount=1'),
    }

    const result = verifySnapshot(tampered, now())
    expect(result.verified).toBe(false)
    expect(result.drift).toHaveLength(1)
    expect(result.drift[0]?.code).toBe('seal_broken')
  })

  it('reports a document that is gone rather than deleted', () => {
    // A deletion under the bewaarplicht keeps its row; this does not.
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(sealed, now({ documents: [input().documents[0]!] }))

    expect(result.drift.map((entry) => entry.code)).toEqual(['document_missing'])
  })

  it('accepts a document that has since been deleted under its term', () => {
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(
      sealed,
      now({
        documents: input().documents.map((document) => ({ ...document, deleted: true })),
      }),
    )

    expect(result.verified).toBe(true)
  })

  it('reports a document that came back after being sealed as deleted', () => {
    const sealed = sealSnapshot(
      input({ documents: input().documents.map((document) => ({ ...document, deleted: true })) }),
    )
    const result = verifySnapshot(sealed, now())

    expect(result.drift.map((entry) => entry.code)).toEqual([
      'document_undeleted',
      'document_undeleted',
    ])
  })

  it('reports a resized document', () => {
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(
      sealed,
      now({
        documents: [input().documents[0]!, { ...input().documents[1]!, sizeBytes: 9_999 }],
      }),
    )

    expect(result.drift.map((entry) => entry.code)).toEqual(['document_changed'])
  })

  it('reports an auditfile that exports differently, and says it is usually benign', () => {
    const sealed = sealSnapshot(input())
    const result = verifySnapshot(sealed, now({ auditFileSha256: '7'.repeat(64) }))

    expect(result.drift[0]?.code).toBe('audit_file_changed')
    expect(result.drift[0]?.detail).toContain('changed exporter')
  })

  it('does not report the auditfile when it was not recomputed', () => {
    // Verifying without re-exporting is a cheap check somebody should be able
    // to run, and it must not report drift it did not look for.
    const sealed = sealSnapshot(input())
    expect(verifySnapshot(sealed, now({ auditFileSha256: null })).verified).toBe(true)
  })
})
