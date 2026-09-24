import { checkPurchaseInvoice, MAX_DOCUMENT_BYTES, type PurchaseInvoiceInput } from '@klopt/core'
import {
  receiveDocument,
  withInbox,
  withInboxRead,
  type ReceiveDocumentRequest as ReceiveRequest,
  type StoredParse,
} from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { documentStore } from '../document-store.js'
import type { DiscardInboxItemBody, DraftFromInboxBody } from '../schemas.js'

/**
 * The purchase inbox (spec 6, 7.5).
 *
 * "A purchase-invoice inbox that ingests email, PDF, and Peppol UBL into the
 * same queue." One queue whatever the source, because the work in front of a
 * bookkeeper is the same work regardless of how the document arrived.
 *
 * Everything that arrives is stored first and understood second. The bytes go
 * into the content-addressed store and get a row before anything is parsed, so
 * a document we cannot read is still a document somebody can open — and the
 * commonest arrival, a PDF, is exactly that. Reading is best-effort and its
 * result is *stored*, not recomputed: a reader that improves next month should
 * not silently change what an operator was shown last week.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError('idempotency_key_required', 'Every write needs an Idempotency-Key header.')
  }
  return context.idempotencyKey
}

/** Back to the domain shape, from what was stored at arrival. */
function toInput(stored: StoredParse['invoice']): PurchaseInvoiceInput {
  return {
    supplierInvoiceNumber: stored.supplierInvoiceNumber,
    kind: stored.kind,
    invoiceDate: stored.invoiceDate,
    dueDate: stored.dueDate,
    currency: stored.currency,
    netMinorUnits: BigInt(stored.net),
    taxMinorUnits: BigInt(stored.tax),
    totalMinorUnits: BigInt(stored.total),
    lines: stored.lines.map((line) => ({
      description: line.description,
      accountNumber: line.accountNumber,
      taxCode: line.taxCode,
      netMinorUnits: BigInt(line.net),
      taxMinorUnits: BigInt(line.tax),
    })),
  }
}

export type ReceiveDocumentRequest = Omit<ReceiveRequest, 'entityId'>

/**
 * Put something in the inbox.
 *
 * The work itself lives in `@klopt/db`, because the worker's mailbox poller
 * goes through exactly the same path. Two doorways into one queue that parsed,
 * matched or deduplicated differently would make an invoice behave differently
 * depending on how it arrived, which is what "one queue" was meant to rule out.
 */
export async function handleReceiveDocument(
  context: RequestContext,
  request: ReceiveDocumentRequest,
) {
  requirePermission(context, 'ledger:post')
  requireIdempotencyKey(context)

  if (request.bytes.byteLength === 0) {
    throw new ApiError('validation_failed', 'There is nothing in this file.')
  }

  if (request.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new ApiError(
      'validation_failed',
      `That file is larger than ${String(MAX_DOCUMENT_BYTES)} bytes, which is more than this inbox will take.`,
      [
        {
          code: 'file_too_large',
          path: 'file',
          message: `Maximum size is ${String(MAX_DOCUMENT_BYTES)} bytes.`,
        },
      ],
    )
  }

  const received = await receiveDocument(context.database, documentStore(), {
    ...request,
    entityId: context.entityId,
  })

  return {
    status: received.alreadyTaken ? 200 : 201,
    body: {
      id: received.id,
      documentId: received.documentId,
      sha256: received.sha256,
      // "You already had this one." The point of content addressing.
      alreadyHeld: received.alreadyHeld,
      // "You already sent me this one." The point of the external id.
      alreadyTaken: received.alreadyTaken,
      parsed: received.parsed,
      parseError: received.parseError,
      matchedSupplier: received.matchedSupplier,
    },
  }
}

export async function handleListInbox(
  context: RequestContext,
  query: { readonly state?: 'new' | 'drafted' | 'discarded' | undefined },
) {
  requirePermission(context, 'ledger:read')

  return withInboxRead(context.database, async (repository) => {
    const rows = await repository.list(context.entityId, query.state)

    return {
      status: 200,
      body: {
        items: rows.map((row) => ({
          id: row.id,
          state: row.state,
          source: row.source,
          receivedFrom: row.receivedFrom,
          subject: row.subject,
          filename: row.filename,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
          documentId: row.documentId,
          sha256: row.sha256,
          receivedAt: row.receivedAt,
          parsed: row.parsed as StoredParse | null,
          parseError: row.parseError,
          contactNumber: row.contactNumber,
          contactName: row.contactName,
          purchaseInvoiceId: row.purchaseInvoiceId,
          discardedReason: row.discardedReason,
          seenBefore: row.duplicateOfCount > 0,
        })),
        waiting: rows.filter((row) => row.state === 'new').length,
      },
    }
  })
}

/**
 * Turn an arrival into a purchase draft.
 *
 * The document travels with it: `document_links` records that this invoice's
 * original is that XML, which is spec 7.6's "linked to its postings" and what
 * an inspector asks for.
 *
 * The supplier and the coding can be overridden, because the parse suggests and
 * a human decides. What cannot be overridden is the *amounts* — those are the
 * document's, and a screen that let somebody edit them here would be a screen
 * for making the books disagree with the paper.
 */
export async function handleDraftFromInbox(
  context: RequestContext,
  itemId: string,
  body: DraftFromInboxBody,
) {
  // `ledger:draft`, not `ledger:post`. Turning a document into a draft is the
  // half an agent may do; booking it is the release. `grants` lets
  // `ledger:post` satisfy this, so nothing that could already draft stopped.
  requirePermission(context, 'ledger:draft')
  requireIdempotencyKey(context)

  return withInbox(context.database, async ({ inbox, purchase }) => {
    const item = await inbox.get(context.entityId, itemId)
    if (item === null) throw new ApiError('not_found', `No inbox item ${itemId}.`)
    if (item.state !== 'new') {
      throw new ApiError(
        'conflict',
        item.state === 'drafted'
          ? 'This document has already been turned into a draft.'
          : 'This document was discarded.',
      )
    }
    if (item.parsed === null) {
      throw new ApiError(
        'validation_failed',
        'Nothing could be read out of this document, so there is nothing to draft from. Enter the invoice by hand and attach the file to it.',
      )
    }

    const stored = item.parsed as StoredParse
    const contactNumber = body.contactNumber ?? item.contactNumber
    if (contactNumber === null) {
      throw new ApiError(
        'validation_failed',
        'This document was not matched to a supplier. Say which one it is, or add the supplier first.',
      )
    }

    const invoiceContext = await purchase.loadContext(context.entityId, contactNumber)
    if (invoiceContext === null) {
      throw new ApiError('not_found', `No contact ${contactNumber}.`)
    }

    // The coding a human confirmed, over the coding the parse suggested. The
    // amounts stay the document's either way.
    const coded: PurchaseInvoiceInput = {
      ...toInput(stored.invoice),
      lines: toInput(stored.invoice).lines.map((line, index) => {
        const override = body.lines?.[index]
        return {
          ...line,
          accountNumber: override?.accountNumber ?? line.accountNumber,
          taxCode: override?.taxCode ?? line.taxCode,
        }
      }),
    }

    for (const line of coded.lines) {
      if (!invoiceContext.accountIdByNumber.has(line.accountNumber)) {
        throw new ApiError(
          'validation_failed',
          `No account ${line.accountNumber === '' ? '(none chosen)' : line.accountNumber}. Every line needs one before it can be drafted.`,
        )
      }
      if (!invoiceContext.taxCodeIdByCode.has(line.taxCode)) {
        throw new ApiError(
          'validation_failed',
          `No tax code ${line.taxCode === '' ? '(none chosen)' : line.taxCode}. The document says what the sender did; what we may deduct is a choice.`,
        )
      }
    }

    if (
      await inbox.invoiceExists(
        context.entityId,
        invoiceContext.contact.id,
        coded.supplierInvoiceNumber,
      )
    ) {
      throw new ApiError(
        'conflict',
        `${invoiceContext.contact.name} has already sent invoice ${coded.supplierInvoiceNumber}. This is the same document arriving twice.`,
      )
    }

    const findings = checkPurchaseInvoice({
      invoice: coded,
      rules: invoiceContext.rules,
      isDuplicate: false,
    })

    const invoiceId = await purchase.createDraft({
      entityId: context.entityId,
      contactId: invoiceContext.contact.id,
      invoice: coded,
      paymentReference: stored.paymentReference,
      notes: null,
      taxCodeIdByCode: invoiceContext.taxCodeIdByCode,
      accountIdByNumber: invoiceContext.accountIdByNumber,
    })

    // The original travels with the invoice. Spec 7.6: linked to its postings.
    await inbox.link({
      entityId: context.entityId,
      documentId: item.documentId,
      subjectKind: 'purchase_invoice',
      subjectId: invoiceId,
      role: 'original',
    })

    await inbox.markDrafted({
      entityId: context.entityId,
      itemId,
      purchaseInvoiceId: invoiceId,
      contactId: invoiceContext.contact.id,
      actorId: context.actor.id,
    })

    await recordAudit(context, {
      action: 'inbox.draft',
      resourceType: 'inbox_item',
      resourceId: itemId,
      before: { state: 'new' },
      after: {
        state: 'drafted',
        purchaseInvoiceId: invoiceId,
        supplierInvoiceNumber: coded.supplierInvoiceNumber,
      },
    })

    return {
      status: 201,
      body: {
        id: invoiceId,
        inboxItemId: itemId,
        supplierInvoiceNumber: coded.supplierInvoiceNumber,
        contactNumber: invoiceContext.contact.number,
        total: coded.totalMinorUnits.toString(),
        findings: findings.map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          // The key and its values, so a client writes the sentence in its own
          // language (ADR 0047). `message` stays: not every client has a catalogue.
          messageKey: finding.messageKey,
          detail: finding.detail ?? null,
          message: finding.message,
          lineNumber: finding.lineNumber,
        })),
        bookable: !findings.some((finding) => finding.severity === 'blocking'),
      },
    }
  })
}

export async function handleDiscardInboxItem(
  context: RequestContext,
  itemId: string,
  body: DiscardInboxItemBody,
) {
  requirePermission(context, 'ledger:post')
  requireIdempotencyKey(context)

  return withInbox(context.database, async ({ inbox }) => {
    const item = await inbox.get(context.entityId, itemId)
    if (item === null) throw new ApiError('not_found', `No inbox item ${itemId}.`)
    if (item.state === 'drafted') {
      throw new ApiError(
        'conflict',
        'This document became a draft. Cancel or reverse the invoice instead — discarding it here would leave the invoice with no original attached.',
      )
    }

    await inbox.discard({
      entityId: context.entityId,
      itemId,
      reason: body.reason,
      actorId: context.actor.id,
    })

    // The document itself is kept. Discarding says "this is not an invoice for
    // us", not "these bytes never existed" — the bewaarplicht does not care
    // what somebody meant to send.
    await recordAudit(context, {
      action: 'inbox.discard',
      resourceType: 'inbox_item',
      resourceId: itemId,
      before: { state: item.state },
      after: { state: 'discarded', reason: body.reason },
    })

    return { status: 200, body: { id: itemId, state: 'discarded', reason: body.reason } }
  })
}

/** The stored bytes, for download. */
export async function handleGetDocument(
  context: RequestContext,
  documentId: string,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  requirePermission(context, 'ledger:read')

  const found = await withInboxRead(context.database, (repository) =>
    repository.document(context.entityId, documentId),
  )
  if (found === null) throw new ApiError('not_found', `No document ${documentId}.`)

  /**
   * A document deleted after its term says so, rather than answering 404.
   *
   * The row survives a deletion precisely so this question has an answer: the
   * hash, the date and the reason are what an inspector asking "what used to be
   * here" is entitled to. A bare 404 would make a deliberate, audited deletion
   * indistinguishable from a lost file.
   */
  if (found.deletedAt !== null) {
    throw new ApiError(
      'gone',
      `Document ${documentId} was deleted on ${found.deletedAt.toISOString().slice(0, 10)} after its bewaarplicht ran out: ${found.deletedReason ?? 'no reason recorded'}. Its hash is ${found.sha256}.`,
    )
  }

  const bytes = await documentStore().get(found.sha256)
  if (bytes === null) {
    throw new ApiError(
      'not_found',
      `Document ${documentId} is recorded but its bytes are not in the store. Check KLOPT_DOCUMENT_DIR.`,
    )
  }

  return {
    bytes,
    contentType: found.contentType,
    filename: found.filename ?? `${found.sha256.slice(0, 12)}.bin`,
  }
}
