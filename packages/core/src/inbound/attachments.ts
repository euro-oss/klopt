import { createHash } from 'node:crypto'
import type { InboundAttachment, InboundMessage } from '../ports/index.js'

/**
 * Which parts of an arriving message are documents (spec 6, 7.5).
 *
 * An invoice does not arrive alone. It arrives with the sender's logo, their
 * S/MIME signature, a vCard, the disclaimer their mail server bolted on, and
 * three quoted copies of the thread it was forwarded through. A queue that
 * takes all of it is a queue nobody reads, and an invoice nobody reads is an
 * invoice nobody pays.
 *
 * ## Keeping is the default; skipping is the exception
 *
 * The rules below say what to skip. Everything else is kept, including formats
 * nothing here can parse — a `.docx` invoice is a real thing that a real
 * supplier really sends, and the inbox's whole design is that a document we
 * cannot read is still a document somebody can open. Losing it because a parser
 * did not recognise it would be the worst thing an inbox could do.
 *
 * ## Nothing is thrown away silently
 *
 * A skipped part keeps its reason, and a message where everything was skipped
 * still becomes an inbox item — a discarded one, with the reason on it, holding
 * the message itself. So the newsletter sent to `facturen@` is out of the way
 * rather than gone, and the day somebody swears they emailed an invoice there is
 * a place to look that answers the question.
 *
 * ## An inline image is a signature; an attached one may be a receipt
 *
 * This is the distinction `Content-Disposition` exists to make, and it is worth
 * trusting. A photograph of a petrol receipt is a genuine document and arrives
 * as an attached JPEG. A company logo is the same JPEG marked `inline` and
 * referenced by the HTML body. The only images skipped are the inline ones and
 * the ones too small to be a photograph of anything.
 */

export type SkipReason =
  | 'empty'
  | 'too_large'
  | 'signature_part'
  | 'inline_image'
  | 'image_too_small'
  | 'not_a_document'
  | 'archive'
  | 'duplicate_of_earlier_part'
  | 'too_many_parts'

export interface SelectedAttachment {
  readonly attachment: InboundAttachment
  readonly sha256: string
}

export interface SkippedAttachment {
  readonly filename: string | null
  readonly contentType: string
  readonly sizeBytes: number
  readonly reason: SkipReason
  /** Said in the words somebody reading the inbox would use. */
  readonly message: string
}

export interface AttachmentSelection {
  readonly keep: readonly SelectedAttachment[]
  readonly skip: readonly SkippedAttachment[]
}

/**
 * The biggest attachment worth storing.
 *
 * A scanned invoice from a badly configured copier is genuinely 20 MB, so the
 * limit has to be well above what looks reasonable. Above this it is not an
 * invoice; it is somebody sending the whole year's archive.
 */
const MAX_BYTES = 30 * 1024 * 1024

/** Below this an image is a logo, not a photograph of a document. */
const MIN_IMAGE_BYTES = 20 * 1024

/** Past this many, the message is not an invoice; it is a mailing. */
const MAX_PARTS = 20

const SIGNATURE_TYPES = new Set([
  'application/pkcs7-signature',
  'application/x-pkcs7-signature',
  'application/pgp-signature',
])

const NOT_DOCUMENTS = new Set(['text/calendar', 'text/vcard', 'text/x-vcard', 'application/ics'])

const ARCHIVE_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/gzip',
])

const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.gz', '.tar']

function baseType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

function looksLikeArchive(attachment: InboundAttachment): boolean {
  if (ARCHIVE_TYPES.has(baseType(attachment.contentType))) return true
  const name = attachment.filename?.toLowerCase() ?? ''
  return ARCHIVE_EXTENSIONS.some((extension) => name.endsWith(extension))
}

function describe(attachment: InboundAttachment): string {
  return attachment.filename ?? `an unnamed ${baseType(attachment.contentType)} part`
}

/**
 * Decide what to keep out of one message.
 *
 * Order matters only in that the first matching rule wins and its reason is the
 * one recorded, which is why the cheap structural checks come before the ones
 * about what the part is.
 */
export function selectInboundAttachments(message: InboundMessage): AttachmentSelection {
  const keep: SelectedAttachment[] = []
  const skip: SkippedAttachment[] = []
  const seen = new Set<string>()

  const reject = (attachment: InboundAttachment, reason: SkipReason, text: string): void => {
    skip.push({
      filename: attachment.filename,
      contentType: attachment.contentType,
      sizeBytes: attachment.bytes.byteLength,
      reason,
      message: text,
    })
  }

  for (const attachment of message.attachments) {
    const type = baseType(attachment.contentType)
    const size = attachment.bytes.byteLength

    if (size === 0) {
      reject(attachment, 'empty', `${describe(attachment)} is empty.`)
      continue
    }
    if (size > MAX_BYTES) {
      reject(
        attachment,
        'too_large',
        `${describe(attachment)} is ${String(Math.round(size / 1024 / 1024))} MB, which is too big to be an invoice.`,
      )
      continue
    }
    if (SIGNATURE_TYPES.has(type)) {
      reject(
        attachment,
        'signature_part',
        `${describe(attachment)} is the message's own signature, not something the sender attached.`,
      )
      continue
    }
    if (NOT_DOCUMENTS.has(type)) {
      reject(attachment, 'not_a_document', `${describe(attachment)} is a calendar or contact file.`)
      continue
    }
    if (looksLikeArchive(attachment)) {
      // Not unpacked here. Unpacking untrusted archives from a public mailbox
      // is a decision with a security cost, and a zip of twelve invoices is a
      // thing somebody should look at anyway.
      reject(
        attachment,
        'archive',
        `${describe(attachment)} is an archive. Open it and attach the invoices separately.`,
      )
      continue
    }
    if (type.startsWith('image/')) {
      if (attachment.inline) {
        reject(
          attachment,
          'inline_image',
          `${describe(attachment)} is part of the message's layout — a logo in a signature, usually.`,
        )
        continue
      }
      if (size < MIN_IMAGE_BYTES) {
        reject(
          attachment,
          'image_too_small',
          `${describe(attachment)} is too small to be a photograph of a document.`,
        )
        continue
      }
    }

    const sha256 = createHash('sha256').update(attachment.bytes).digest('hex')
    if (seen.has(sha256)) {
      // The same file attached twice — a forward that carried the original as
      // well as the copy. One document, one item.
      reject(
        attachment,
        'duplicate_of_earlier_part',
        `${describe(attachment)} is the same file as an earlier attachment on this message.`,
      )
      continue
    }

    if (keep.length >= MAX_PARTS) {
      reject(
        attachment,
        'too_many_parts',
        `This message has more than ${String(MAX_PARTS)} attachments; only the first ${String(MAX_PARTS)} were taken.`,
      )
      continue
    }

    seen.add(sha256)
    keep.push({ attachment, sha256 })
  }

  return { keep, skip }
}

/**
 * Why a message produced nothing, in one sentence.
 *
 * Used as the reason on the discarded item that holds the message itself, so
 * the answer to "I emailed it, where is it?" is on the screen rather than in a
 * log nobody has.
 */
export function nothingFiledReason(selection: AttachmentSelection): string {
  if (selection.skip.length === 0) {
    return 'This message had no attachments. The message itself has been kept.'
  }

  const reasons = [...new Set(selection.skip.map((entry) => entry.message))]
  return reasons.length === 1
    ? `Nothing to file: ${reasons[0]!}`
    : `Nothing to file. ${reasons.join(' ')}`
}
