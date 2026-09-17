/**
 * Keeping a source document, as a port (spec 7.6).
 *
 * "Every source document (invoice PDF, UBL, receipt, statement, contract) is
 * stored with a SHA-256 content hash and linked to its postings. Documents are
 * content-addressed and deduplicated."
 *
 * Content-addressed is the whole design, and it buys three things at once.
 *
 * **Deduplication is free.** The same invoice arriving by email and again by
 * Peppol is one set of bytes, stored once, and the two arrivals are two rows
 * pointing at it. That is not a space optimisation — it is how the inbox knows
 * they are the same document.
 *
 * **Tamper-evidence is free.** The address *is* the hash, so a stored document
 * that has been altered no longer answers to its own name. The bewaarplicht is
 * seven years and the legal test is that the administration stays "accessible,
 * readable and controllable"; a store where the bytes can quietly change fails
 * that test whatever else it does.
 *
 * **There is nothing to name.** No filenames to collide, no directory scheme to
 * migrate, no question about what happens when two people upload `factuur.pdf`.
 * The filename is metadata on the link, not the identity of the bytes.
 *
 * The default implementation is a directory. Spec 8's first rule: every adapter
 * family has an implementation that needs no third party, and it is the default
 * in a fresh install. An S3-compatible store is an adapter for somebody who
 * wants one, not a prerequisite for keeping books.
 */

export interface StoredDocument {
  /** Lowercase hex SHA-256 of the bytes. The address and the identity. */
  readonly sha256: string
  readonly sizeBytes: number
  readonly contentType: string
}

export interface DocumentStore {
  readonly name: string
  /**
   * Store the bytes and return their address.
   *
   * Idempotent by construction: putting the same bytes twice is one document.
   * An implementation that already holds the hash may skip the write, and
   * `existed` says which happened — the inbox shows it, because "this is the
   * same file you already had" is worth knowing.
   */
  put(
    bytes: Uint8Array,
    metadata: { readonly contentType: string },
  ): Promise<StoredDocument & { readonly existed: boolean }>

  get(sha256: string): Promise<Uint8Array | null>

  has(sha256: string): Promise<boolean>

  /**
   * Remove the bytes, after their bewaarplicht has run out (spec 7.6).
   *
   * The only destructive operation in this port, and it exists because the
   * alternative — never deleting — is not what the law asks for either. What
   * the law asks for is that deletion is deliberate: "a deliberate, audited,
   * permissioned batch action with a preview. Never automatic." So there is no
   * expiry sweep behind this and no lifecycle rule; something calls it because
   * somebody pressed a button.
   *
   * The three outcomes are three different facts and the caller has to be able
   * to tell them apart:
   *
   *   - `deleted` — the bytes are gone.
   *   - `absent` — there were none. Not an error: a store that already lost
   *     them and one that just dropped them are the same state, and a retry of
   *     a half-finished run has to be able to say so.
   *   - `locked` — the store refused, because its own retention has not
   *     expired. **That is the point of a WORM store**, and it must not be
   *     reported as success. A run that said "deleted" about bytes still on
   *     disk would be the worst answer available.
   */
  delete(sha256: string): Promise<DocumentDeletion>
}

export type DocumentDeletion =
  | { readonly outcome: 'deleted' }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'locked'; readonly until: string | null }

/**
 * A store that can hold bytes down itself (spec 7.6).
 *
 * > "Object storage with object lock or WORM mode, with a retention date
 * > computed per document from its fiscal year."
 *
 * Separate from `DocumentStore` rather than optional methods on it, because the
 * difference is not a detail: a store with this can *refuse* the application,
 * and one without it cannot. `supportsWorm` is the type guard, and the
 * retention screen prints the answer rather than implying one.
 *
 * ## The lock is applied when the term is known, not when the bytes arrive
 *
 * This is the part that shapes everything. Object lock is set per object and
 * can be extended but never shortened — and at the moment bytes arrive, their
 * retention term is *unknown*, because it is counted from the book year of
 * whatever the document turns out to be evidence for (ADR 0030). Guessing at
 * PUT time would lock a 2018 receipt until 2033.
 *
 * So bytes are stored unlocked and `retain` is called when the term is derived.
 * The window between is real and worth being honest about: an object with no
 * lock yet is protected by the application and not by the storage, which is
 * exactly what `unlockedCount` on the retention screen is for.
 */
export interface WormDocumentStore extends DocumentStore {
  readonly worm: {
    /** `compliance` cannot be bypassed by anybody; `governance` can, with a permission. */
    readonly mode: 'compliance' | 'governance'
  }

  /**
   * Hold these bytes until this date.
   *
   * Idempotent, and monotonic: setting a later date extends, setting an earlier
   * one is refused by the store in compliance mode. Both are correct — a
   * retention term in this system only ever grows (seven years becomes ten for
   * onroerend goed), and a term that could shrink would make the lock worthless.
   */
  retain(sha256: string, until: string): Promise<void>

  /** The date the store is holding these bytes until, if any. */
  retentionOf(sha256: string): Promise<{ readonly until: string; readonly mode: string } | null>

  /**
   * Whether the bucket really has object lock turned on.
   *
   * Asked rather than assumed, and that distinction is the whole point of this
   * port. "This is an S3 store" and "this bucket holds bytes down" are
   * different claims: object lock can only be enabled when a bucket is created,
   * and a stack that came up against a bucket made before anybody wanted one
   * works perfectly while guaranteeing nothing.
   *
   * A compliance screen reporting `objectLock: true` because of the store's
   * *class* rather than the bucket's *configuration* would be exactly the kind
   * of unverified claim this whole file exists to avoid.
   */
  verifyLock(): Promise<{ readonly enabled: boolean; readonly reason: string | null }>
}

export function supportsWorm(store: DocumentStore): store is WormDocumentStore {
  return 'worm' in store && typeof (store as WormDocumentStore).retain === 'function'
}

/** Lowercase hex SHA-256, computed the same way everywhere. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Guess a content type from a filename, for an upload that did not say.
 *
 * Deliberately short. What matters is telling a UBL invoice from a PDF, because
 * one can be parsed into a draft and the other cannot — everything else is
 * `application/octet-stream` and nobody is worse off.
 */
export function contentTypeFor(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  switch (extension) {
    case 'xml':
    case 'ubl':
      return 'application/xml'
    case 'pdf':
      return 'application/pdf'
    case 'csv':
      return 'text/csv'
    case 'txt':
      return 'text/plain'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}

/** Whether this is something `parseUblInvoice` could be pointed at. */
export function looksLikeXml(contentType: string, bytes: Uint8Array): boolean {
  if (contentType.includes('xml')) return true
  // A sender who labels their UBL `application/octet-stream` is common enough
  // to be worth sniffing for, and the first non-space byte settles it.
  const head = new TextDecoder().decode(bytes.slice(0, 200)).trimStart()
  return head.startsWith('<?xml') || head.startsWith('<')
}
