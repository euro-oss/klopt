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
