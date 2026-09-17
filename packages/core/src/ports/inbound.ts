/**
 * Documents arriving on their own, as a port (spec 6, 7.5).
 *
 * The inbox already takes an upload. This is the other half: a mailbox somebody
 * forwards invoices to, and a Peppol access point handing over what the network
 * delivered. Same queue, same shape, different doorway — because the work in
 * front of a bookkeeper is the same work regardless of how the document got
 * there.
 *
 * Spec 8's four rules, and how they land here:
 *
 *  1. **A file-based implementation that needs no third party, and it is the
 *     default.** A directory of `.eml` files is that. It is not a toy: it is
 *     exactly what a `procmail`, a `fetchmail` or a mail server's own delivery
 *     hook produces, and it means a self-hosted instance can receive invoices
 *     by email without this process holding an IMAP credential at all.
 *  2. **Credentials are per entity.** A mailbox belongs to an administration —
 *     `facturen@ditbedrijf.nl` is not an instance-wide fact the way a signing
 *     certificate nearly is. So a source is a row against an entity, not an
 *     environment variable, and the poller is told which one it is polling.
 *  3. **Every adapter records every request and response.** `InboundPoll` is
 *     that record, kept whether the poll found anything or failed outright.
 *  4. **A failing adapter never blocks bookkeeping.** A poll that cannot reach
 *     its server records the failure and returns; nothing throws upwards, and
 *     the upload path is untouched. An inbox that is one mailbox short is worse
 *     than yesterday; an inbox nobody can upload to is broken.
 *
 * ## What a source is not allowed to decide
 *
 * A source hands over what arrived. It does not decide whether the sender is a
 * known supplier, whether the document is an invoice, or what to do with it —
 * all of that is the inbox's business and happens once, in one place, however
 * the document came in. The temptation is to let the IMAP adapter file mail
 * from a known address straight into a draft; the reason not to is that an
 * email address is not a proof of anything, and a document filed without
 * anybody looking is a document nobody looks at.
 */

/** One file that came with a message. */
export interface InboundAttachment {
  readonly filename: string | null
  readonly contentType: string
  readonly bytes: Uint8Array
  /**
   * True when the part was marked `inline` — a logo in a signature, usually,
   * rather than something the sender meant to send.
   */
  readonly inline: boolean
  /** `Content-ID`, when the part had one. Referenced by inline HTML. */
  readonly contentId: string | null
}

/** One arrival, whatever carried it. */
export interface InboundMessage {
  /**
   * The transport's own identifier for this arrival: a `Message-ID`, a Peppol
   * transmission id, a filename in a drop directory.
   *
   * This is what makes polling safe to repeat. The bytes are deduplicated by
   * their hash, but two arrivals of the same document are two arrivals and both
   * belong in the queue — so "have I already taken this message" cannot be
   * answered by the content, only by the transport's own name for it.
   */
  readonly externalId: string
  readonly source: 'email' | 'peppol'
  /** An email address, or a Peppol participant identifier. */
  readonly receivedFrom: string | null
  readonly subject: string | null
  /** When the transport says it arrived, ISO 8601. */
  readonly receivedAt: string
  readonly attachments: readonly InboundAttachment[]
  /**
   * The arrival's own bytes — the whole RFC 822 message, or the document for a
   * transport that carries one.
   *
   * Kept because it is what makes "I emailed it, where is it?" answerable. A
   * message whose every part was skipped still has this, and storing it is the
   * difference between an answer and a shrug.
   */
  readonly raw: Uint8Array
}

export interface InboundPoll {
  readonly source: string
  readonly ok: boolean
  readonly messages: readonly InboundMessage[]
  /** Why the poll failed, when it did. The messages are then empty. */
  readonly failure: string | null
  /**
   * Where to resume. Opaque to everything but the adapter that produced it —
   * a UID for IMAP, a timestamp for a pull API, null for a drop directory that
   * moves what it has taken.
   */
  readonly cursor: string | null
}

export interface InboundSource {
  readonly name: string
  readonly source: 'email' | 'peppol'
  /**
   * Whether this source can be polled at all, and why not.
   *
   * Asked before polling so a misconfigured mailbox is a greyed-out row that
   * explains itself, rather than a failure logged every five minutes.
   */
  available(): { readonly ok: boolean; readonly reason: string | null }
  /**
   * Take what has arrived since `cursor`.
   *
   * Never throws. A source that cannot be reached returns `ok: false` with the
   * reason, because a mailbox being down is not an error in the books.
   */
  poll(cursor: string | null): Promise<InboundPoll>
  /**
   * Tell the source these messages are safely stored.
   *
   * Separate from `poll` on purpose, and called only after the documents are
   * committed: a message moved to a `Verwerkt` folder before the transaction
   * commits is a message nobody will ever see again. At-least-once is the
   * correct failure direction here, and `externalId` makes the duplicate
   * harmless.
   */
  acknowledge(externalIds: readonly string[]): Promise<void>
}
