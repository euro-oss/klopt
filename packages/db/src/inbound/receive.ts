import {
  contentTypeFor,
  looksLikeXml,
  MAX_DOCUMENT_BYTES,
  nothingFiledReason,
  parseUblInvoice,
  selectInboundAttachments,
  type DocumentStore,
  type InboundInvoice,
  type InboundMessage,
} from '@klopt/core'
import type { Database } from '../client.js'
import { withInbox, withPurchaseRead } from '../unit-of-work.js'

/**
 * Putting something in the purchase inbox (spec 6, 7.5).
 *
 * This lives here, below the web app, because there are two doorways into one
 * queue and they must not drift. A browser uploads a PDF; a mailbox poller in
 * the worker hands over what arrived overnight. If the parsing, the supplier
 * matching or the deduplication differed between them, an invoice would behave
 * differently depending on how it got here — which is exactly what "one queue"
 * was meant to rule out.
 *
 * Everything that arrives is **stored first and understood second**. The bytes
 * go into the content-addressed store and get a row before anything is parsed,
 * so a document we cannot read is still a document somebody can open — and the
 * commonest arrival, a PDF, is exactly that. Reading is best-effort and its
 * result is stored rather than recomputed: a reader that improves next month
 * should not silently change what an operator was shown last week.
 */

/** The parse, as it is stored and shown. Amounts as strings, like the wire. */
function serialiseParsed(parsed: InboundInvoice) {
  return {
    supplier: parsed.supplier,
    invoice: {
      supplierInvoiceNumber: parsed.invoice.supplierInvoiceNumber,
      kind: parsed.invoice.kind,
      invoiceDate: parsed.invoice.invoiceDate,
      dueDate: parsed.invoice.dueDate,
      currency: parsed.invoice.currency,
      net: parsed.invoice.netMinorUnits.toString(),
      tax: parsed.invoice.taxMinorUnits.toString(),
      total: parsed.invoice.totalMinorUnits.toString(),
      lines: parsed.invoice.lines.map((line, index) => ({
        lineNumber: index + 1,
        description: line.description,
        accountNumber: line.accountNumber,
        taxCode: line.taxCode,
        net: line.netMinorUnits.toString(),
        tax: line.taxMinorUnits.toString(),
      })),
    },
    buyerReference: parsed.buyerReference,
    paymentReference: parsed.paymentReference,
    findings: parsed.findings,
  }
}

/**
 * What was read out of a document at the moment it arrived.
 *
 * Comes back out of `jsonb` as whatever shape it went in as; the cast at that
 * boundary is the honest one, because this is our own writing read back.
 */
export type StoredParse = ReturnType<typeof serialiseParsed>

export interface ReceiveDocumentRequest {
  readonly entityId: string
  readonly bytes: Uint8Array
  readonly filename: string | null
  readonly contentType: string | null
  readonly source: 'upload' | 'email' | 'peppol'
  readonly receivedFrom: string | null
  readonly subject: string | null
  /** The transport's own name for the arrival. Null for an upload. */
  readonly externalId?: string | null
  /** Which part of that arrival this is, when it carried several. */
  readonly externalPart?: string | null
  /** Recorded as discarded on arrival, with this reason. */
  readonly discardedReason?: string | null
}

export interface ReceivedDocument {
  readonly id: string
  readonly documentId: string
  readonly sha256: string
  /** These exact bytes were already here. The point of content addressing. */
  readonly alreadyHeld: boolean
  /** This arrival was already taken. The point of the external id. */
  readonly alreadyTaken: boolean
  readonly parsed: StoredParse | null
  readonly parseError: string | null
  readonly matchedSupplier: {
    readonly id: string
    readonly number: string
    readonly name: string
  } | null
}

export async function receiveDocument(
  database: Database,
  store: DocumentStore,
  request: ReceiveDocumentRequest,
): Promise<ReceivedDocument> {
  if (request.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `That document is larger than ${String(MAX_DOCUMENT_BYTES)} bytes, which is more than this inbox will take.`,
    )
  }

  const contentType =
    request.contentType ??
    (request.filename === null ? 'application/octet-stream' : contentTypeFor(request.filename))

  // Stored before anything is understood. Losing a document because the parser
  // did not like it would be the worst thing an inbox could do.
  const stored = await store.put(request.bytes, { contentType })

  let parsed: StoredParse | null = null
  let parseError: string | null = null
  let identifiers = {
    vatNumber: null as string | null,
    kvkNumber: null as string | null,
    iban: null as string | null,
  }

  if (looksLikeXml(contentType, request.bytes)) {
    const chart = await withPurchaseRead(database, async (repository) => ({
      suspense: await repository.suspenseAccountNumber(request.entityId),
      codes: await repository.taxCodeSuggestions(request.entityId),
      currency: await repository.functionalCurrency(request.entityId),
    }))

    try {
      const read = parseUblInvoice(new TextDecoder().decode(request.bytes), {
        functionalCurrency: chart.currency,
        suspenseAccountNumber: chart.suspense ?? '',
        taxCodes: chart.codes,
      })
      parsed = serialiseParsed(read)
      identifiers = {
        vatNumber: read.supplier.vatNumber,
        kvkNumber: read.supplier.kvkNumber,
        iban: read.supplier.iban,
      }
    } catch (error: unknown) {
      // Not a refusal. An XML file that is not a UBL invoice is still a file
      // somebody sent us, and it belongs in the queue with a note saying why
      // nothing could be read out of it.
      parseError = error instanceof Error ? error.message : String(error)
    }
  }

  return withInbox(database, async ({ inbox }) => {
    const document = await inbox.recordDocument({
      entityId: request.entityId,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      contentType,
      filename: request.filename,
    })

    const contact =
      identifiers.vatNumber === null && identifiers.kvkNumber === null && identifiers.iban === null
        ? null
        : await inbox.matchSupplier(request.entityId, identifiers)

    const added = await inbox.addItem({
      entityId: request.entityId,
      documentId: document.id,
      source: request.source,
      receivedFrom: request.receivedFrom,
      subject: request.subject,
      parsed,
      parseError,
      contactId: contact?.id ?? null,
      externalId: request.externalId ?? null,
      externalPart: request.externalPart ?? null,
      discardedReason: request.discardedReason ?? null,
    })

    return {
      id: added.id,
      documentId: document.id,
      sha256: stored.sha256,
      alreadyHeld: document.existed,
      alreadyTaken: added.existed,
      parsed,
      parseError,
      matchedSupplier: contact,
    }
  })
}

export interface IngestedMessage {
  readonly source: string
  readonly externalId: string
  /** One per attachment that was filed. Empty when nothing was. */
  readonly documents: readonly ReceivedDocument[]
  /** What was left behind, and why. */
  readonly skipped: readonly { readonly filename: string | null; readonly reason: string }[]
  /** True when the whole arrival had already been taken. */
  readonly alreadyTaken: boolean
}

/**
 * Turn one arrival into inbox items.
 *
 * The message itself is stored whatever happens, as `message/rfc822`. That is
 * not tidiness: it is what makes "I emailed it, where is it?" answerable. A
 * message whose every part was skipped still becomes an item — a discarded one,
 * holding the message, with the reason on it — so the newsletter sent to
 * `facturen@` is out of the way rather than gone.
 */
export async function ingestInboundMessage(
  database: Database,
  store: DocumentStore,
  request: { readonly entityId: string; readonly message: InboundMessage },
): Promise<IngestedMessage> {
  const { message } = request
  const selection = selectInboundAttachments(message)

  const skipped = selection.skip.map((entry) => ({
    filename: entry.filename,
    reason: entry.message,
  }))

  if (selection.keep.length === 0) {
    const received = await receiveDocument(database, store, {
      entityId: request.entityId,
      bytes: message.raw,
      filename: filenameFor(message),
      contentType: 'message/rfc822',
      source: message.source,
      receivedFrom: message.receivedFrom,
      subject: message.subject,
      externalId: message.externalId,
      externalPart: 'message',
      discardedReason: nothingFiledReason(selection),
    })

    return {
      source: message.source,
      externalId: message.externalId,
      documents: [],
      skipped,
      alreadyTaken: received.alreadyTaken,
    }
  }

  const documents: ReceivedDocument[] = []
  for (const [index, selected] of selection.keep.entries()) {
    documents.push(
      await receiveDocument(database, store, {
        entityId: request.entityId,
        bytes: selected.attachment.bytes,
        filename: selected.attachment.filename,
        contentType: selected.attachment.contentType,
        source: message.source,
        receivedFrom: message.receivedFrom,
        subject: message.subject,
        externalId: message.externalId,
        // Positional rather than the filename, because two parts of one message
        // are allowed to share a name and the pair has to stay unique.
        externalPart: String(index),
      }),
    )
  }

  return {
    source: message.source,
    externalId: message.externalId,
    documents,
    skipped,
    alreadyTaken: documents.every((document) => document.alreadyTaken),
  }
}

/** A filename for the message itself, so a download has something to be called. */
function filenameFor(message: InboundMessage): string {
  const subject = (message.subject ?? 'bericht').replace(/[^\p{L}\p{N} .-]/gu, '').slice(0, 60)
  return `${subject.trim() === '' ? 'bericht' : subject.trim()}.eml`
}
