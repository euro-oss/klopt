import { createHash } from 'node:crypto'
import { simpleParser } from 'mailparser'
import type { InboundAttachment, InboundMessage } from '@klopt/core'

/**
 * Reading an RFC 822 message into the shape the inbox takes.
 *
 * MIME is not worth reimplementing. Encoded-word filenames, base64 folded at
 * 76 columns, quoted-printable, nested `multipart/related` inside
 * `multipart/mixed`, a `Content-Type` charset the sender got wrong — every one
 * of those is a way to lose an invoice, and all of them are already solved.
 * `mailparser` does that job here and nothing else does it anywhere.
 *
 * What this module decides is only the mapping: which fields become the
 * arrival's identity, and what counts as `inline`.
 */

/**
 * `Content-Disposition: inline` is the signal, and `related` is the corroboration.
 *
 * A logo in a signature is inline *and* referenced by the HTML body, so
 * `mailparser` marks it `related`. A photograph of a receipt is neither. Taking
 * both means a sender whose client omits the disposition is still understood,
 * and a sender who marks a real attachment inline by mistake loses nothing —
 * the size rule downstream catches that case.
 */
function isInline(attachment: {
  contentDisposition?: string | undefined
  related?: boolean | undefined
}): boolean {
  return attachment.contentDisposition === 'inline' || attachment.related === true
}

/**
 * The transport's own name for this arrival.
 *
 * A `Message-ID` when there is one, because that is what it is for and it
 * survives a message being refetched. When there is not — some scanners and
 * some mail-to-webhook gateways omit it — the hash of the whole message stands
 * in. That is weaker: an identical message sent twice reads as one arrival. It
 * is the right weakness, because the alternative is filing the same invoice
 * every time the poller runs.
 */
function identify(parsedMessageId: string | undefined, raw: Uint8Array): string {
  const messageId = parsedMessageId?.trim() ?? ''
  if (messageId !== '') return messageId
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

export async function messageFromRfc822(
  raw: Uint8Array,
  options: {
    readonly externalId?: string | undefined
    readonly receivedAt?: string | undefined
  } = {},
): Promise<InboundMessage> {
  const parsed = await simpleParser(Buffer.from(raw))

  const attachments: InboundAttachment[] = parsed.attachments.map((attachment) => ({
    filename: attachment.filename ?? null,
    contentType: attachment.contentType,
    bytes: new Uint8Array(attachment.content),
    inline: isInline(attachment),
    contentId: attachment.cid ?? null,
  }))

  const from = parsed.from?.value[0]?.address ?? null

  return {
    externalId: options.externalId ?? identify(parsed.messageId, raw),
    source: 'email',
    receivedFrom: from,
    subject: parsed.subject ?? null,
    receivedAt: options.receivedAt ?? parsed.date?.toISOString() ?? new Date().toISOString(),
    attachments,
    raw,
  }
}

/**
 * A bare document, treated as a message carrying one attachment.
 *
 * This is what a Peppol access point hands over and what somebody dropping a
 * UBL file into a directory means. Wrapping it rather than adding a second
 * shape means the attachment rules, the deduplication and the queue all work
 * on one thing.
 */
export function messageFromDocument(request: {
  readonly externalId: string
  readonly source: 'email' | 'peppol'
  readonly filename: string | null
  readonly contentType: string
  readonly bytes: Uint8Array
  readonly receivedFrom: string | null
  readonly subject: string | null
  readonly receivedAt?: string | undefined
}): InboundMessage {
  return {
    externalId: request.externalId,
    source: request.source,
    receivedFrom: request.receivedFrom,
    subject: request.subject,
    receivedAt: request.receivedAt ?? new Date().toISOString(),
    raw: request.bytes,
    attachments: [
      {
        filename: request.filename,
        contentType: request.contentType,
        bytes: request.bytes,
        inline: false,
        contentId: null,
      },
    ],
  }
}
