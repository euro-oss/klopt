import { createHash } from 'node:crypto'
import {
  CUSTOMIZATION_ID,
  DEFAULT_DUNNING_SCHEDULE,
  checkUblRules,
  formatMinorUnits,
  generateUbl,
  planDunning,
  postJournalEntry,
  presentInvoice,
  stageOf,
  systemClock,
  toUblDocument,
  type EInvoiceDocument,
  type PricedInvoice,
  type UblProfile,
} from '@klopt/core'
import {
  invoiceEntryFor,
  priceDraft,
  withInbox,
  withInboxRead,
  withSales,
  withSalesRead,
  type DraftInvoiceRequest,
} from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { invoiceRenderer } from '../documents.js'
import { documentStore } from '../document-store.js'
import { eInvoiceTransport } from '../e-invoice.js'
import { schematron } from '../schematron.js'
import type {
  CreateContactBody,
  DraftInvoiceBody,
  IssueInvoiceBody,
  SendInvoiceBody,
  SendReminderBody,
  UpdateContactBody,
} from '../schemas.js'

/**
 * Sales handlers.
 *
 * Same shape as everything else: resolve permission, call the domain, shape the
 * wire representation. The one thing worth noticing is that issuing an invoice
 * goes through `postJournalEntry` like any other posting — Sales has no
 * privileged route into the ledger, which is the point of the module contract
 * in spec 9.5.
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

function serialisePriced(priced: PricedInvoice) {
  return {
    net: priced.net.toString(),
    tax: priced.tax.toString(),
    total: priced.total.toString(),
    rounding: priced.rounding,
    taxGroups: priced.taxGroups.map((group) => ({
      code: group.tax.code,
      description: group.tax.description,
      ratePercent: (group.tax.rateBasisPoints / 100).toFixed(2),
      ublCategory: group.tax.ublCategory,
      net: group.net.toString(),
      amount: group.amount.toString(),
    })),
    lines: priced.lines.map((line) => ({
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: line.quantity,
      unitCode: line.unitCode,
      unitPrice: line.unitPrice.toString(),
      revenueAccountNumber: line.revenueAccountNumber,
      taxCode: line.tax.code,
      net: line.net.toString(),
      tax: line.tax_.toString(),
    })),
  }
}

export async function handleListContacts(
  context: RequestContext,
  query: { readonly customersOnly: boolean },
) {
  requirePermission(context, 'ledger:read')
  const rows = await withSalesRead(context.database, (repository) =>
    repository.listContacts(context.entityId, query.customersOnly),
  )

  return {
    status: 200,
    body: {
      contacts: rows.map((contact) => ({
        id: contact.id,
        number: contact.number,
        name: contact.name,
        isCustomer: contact.isCustomer,
        isSupplier: contact.isSupplier,
        email: contact.email,
        vatNumber: contact.vatNumber,
        countryCode: contact.countryCode,
        paymentTermsDays: contact.paymentTermsDays,
        isBlocked: contact.isBlocked,
      })),
    },
  }
}

export async function handleCreateContact(context: RequestContext, body: CreateContactBody) {
  requirePermission(context, 'ledger:configure')

  const id = await withSales(context.database, ({ sales }) =>
    sales.createContact({ entityId: context.entityId, ...body }),
  )

  return { status: 201, body: { id, number: body.number } }
}

/**
 * One contact, for correcting it.
 *
 * Includes what is still open against them, because that is what makes
 * "no longer a supplier" a decision rather than a checkbox.
 */
export async function handleGetContact(context: RequestContext, contactId: string) {
  requirePermission(context, 'ledger:read')

  return withSalesRead(context.database, async (repository) => {
    const found = await repository.findContact(context.entityId, contactId)
    if (found === null) throw new ApiError('not_found', 'No such contact.')

    const open = await repository.openDocumentCounts(context.entityId, contactId)
    const { contact, address } = found

    return {
      status: 200,
      body: {
        contact: {
          id: contact.id,
          number: contact.number,
          name: contact.name,
          legalName: contact.legalName,
          isCustomer: contact.isCustomer,
          isSupplier: contact.isSupplier,
          isBlocked: contact.isBlocked,
          email: contact.email,
          phone: contact.phone,
          vatNumber: contact.vatNumber,
          kvkNumber: contact.kvkNumber,
          countryCode: contact.countryCode,
          paymentTermsDays: contact.paymentTermsDays,
          electronicAddress: contact.electronicAddress,
          electronicAddressScheme: contact.electronicAddressScheme,
          iban: contact.iban,
          notes: contact.notes,
          address:
            address === null
              ? null
              : {
                  street: address.street,
                  houseNumber: address.houseNumber,
                  postalCode: address.postalCode,
                  city: address.city,
                  countryCode: address.countryCode,
                },
        },
        openDocuments: open,
      },
    }
  })
}

/**
 * Correct a contact.
 *
 * Master data is corrected in place. There is no journal here to keep honest,
 * and everything already booked points at the same row by id — so fixing a
 * mistyped IBAN fixes the next payment run without touching a cent of what
 * happened before. What was *sent* does not move: an issued invoice's UBL and
 * PDF are stored artefacts, and a name corrected today does not rewrite them.
 *
 * The one refusal is unclassifying somebody who still has open documents.
 * Turning off "is supplier" on a creditor with three unpaid invoices takes them
 * out of the payment run and the ageing while the ledger still carries the
 * liability — the subledger and its control account would part company, exactly
 * as they did in ADR 0027. Blocking them is the thing that was actually meant,
 * and it is offered instead.
 */
export async function handleUpdateContact(
  context: RequestContext,
  contactId: string,
  body: UpdateContactBody,
) {
  requirePermission(context, 'ledger:configure')

  return withSales(context.database, async ({ sales }) => {
    const found = await sales.findContact(context.entityId, contactId)
    if (found === null) throw new ApiError('not_found', 'No such contact.')

    const open = await sales.openDocumentCounts(context.entityId, contactId)
    const problems: { code: string; path: string; message: string }[] = []

    if (body.isCustomer === false && found.contact.isCustomer && open.sales > 0) {
      problems.push({
        code: 'open_documents',
        path: 'isCustomer',
        message: `${found.contact.name} still has ${String(open.sales)} open sales invoice(s). Unmarking them as a customer would take those off the debtors ageing while the ledger still counts them. Block the contact instead.`,
      })
    }
    if (body.isSupplier === false && found.contact.isSupplier && open.purchase > 0) {
      problems.push({
        code: 'open_documents',
        path: 'isSupplier',
        message: `${found.contact.name} still has ${String(open.purchase)} open purchase invoice(s). Unmarking them as a supplier would take those out of the payment run while the ledger still owes them. Block the contact instead.`,
      })
    }

    if (problems.length > 0) {
      throw new ApiError('validation_failed', problems[0]!.message, problems)
    }

    const { address, ...patch } = body
    await sales.updateContact({
      entityId: context.entityId,
      contactId,
      patch,
      ...(address === undefined ? {} : { address }),
    })

    return { status: 200, body: { id: contactId, number: body.number ?? found.contact.number } }
  })
}

export async function handleListTaxCodes(context: RequestContext) {
  requirePermission(context, 'ledger:read')
  const rows = await withSalesRead(context.database, (repository) =>
    repository.listTaxCodes(context.entityId),
  )

  return {
    status: 200,
    body: {
      taxCodes: rows.map((code) => ({
        ...code,
        ratePercent: (code.rateBasisPoints / 100).toFixed(2),
      })),
    },
  }
}

export async function handleDraftInvoice(context: RequestContext, body: DraftInvoiceBody) {
  requirePermission(context, 'ledger:post')
  requireIdempotencyKey(context)

  return withSales(context.database, async ({ sales }) => {
    const invoiceContext = await sales.loadContext(context.entityId, body.contactNumber)
    if (invoiceContext === null) {
      throw new ApiError('not_found', `No contact ${body.contactNumber}.`)
    }
    if (invoiceContext.contact.isBlocked) {
      throw new ApiError(
        'validation_failed',
        `${invoiceContext.contact.name} is blocked. Unblock the contact before invoicing it.`,
      )
    }

    for (const line of body.lines) {
      if (!invoiceContext.revenueAccountNumbers.has(line.revenueAccountNumber)) {
        throw new ApiError('validation_failed', `No account ${line.revenueAccountNumber}.`, [
          {
            code: 'unknown_account',
            path: 'lines',
            message: `No account ${line.revenueAccountNumber}.`,
          },
        ])
      }
    }

    const request: DraftInvoiceRequest = {
      entityId: context.entityId,
      contactNumber: body.contactNumber,
      kind: body.kind,
      issueDate: body.issueDate,
      reference: body.reference,
      buyerReference: body.buyerReference,
      notes: body.notes,
      creditsInvoiceId: body.creditsInvoiceId,
      lines: body.lines,
    }

    // Pricing happens before anything is written, so a bad tax code or an
    // impossible quantity fails without leaving a half-made draft behind.
    const priced = priceDraft(request, invoiceContext)
    const id = await sales.createDraft(request, invoiceContext, priced)

    return { status: 201, body: { id, status: 'draft', ...serialisePriced(priced) } }
  })
}

export async function handleIssueInvoice(
  context: RequestContext,
  invoiceId: string,
  body: IssueInvoiceBody,
) {
  requirePermission(context, 'ledger:post')
  const idempotencyKey = requireIdempotencyKey(context)

  return withSales(context.database, async ({ sales, ledger }) => {
    const invoice = await sales.findInvoice(context.entityId, invoiceId)
    if (invoice === null) throw new ApiError('not_found', `No invoice ${invoiceId}.`)

    if (invoice.status !== 'draft') {
      // Issued is final. A wrong invoice is corrected with a credit note, not
      // by reissuing — the number has been given out and the entry is in the
      // hash chain.
      throw new ApiError(
        'conflict',
        `Invoice ${invoice.number ?? invoiceId} is ${invoice.status}, not a draft.`,
      )
    }

    const invoiceContext = await sales.loadContext(context.entityId, invoice.contactNumber)
    if (invoiceContext === null) throw new ApiError('not_found', 'The contact has gone.')

    // Re-priced from the stored lines rather than trusting the stored totals:
    // a tax rate may have changed between drafting and issuing, and the invoice
    // that goes out must be the one that gets posted.
    const priced = priceDraft(
      {
        entityId: context.entityId,
        contactNumber: invoice.contactNumber,
        kind: invoice.kind,
        issueDate: invoice.issueDate,
        reference: invoice.reference,
        buyerReference: invoice.buyerReference,
        notes: invoice.notes,
        creditsInvoiceId: invoice.creditsInvoiceId,
        lines: invoice.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitCode: line.unitCode,
          unitPrice: line.unitPrice,
          revenueAccountNumber: line.revenueAccountNumber,
          taxCode: line.taxCode,
        })),
      },
      invoiceContext,
    )

    const number = await sales.allocateInvoiceNumber(
      context.entityId,
      invoice.issueDate.slice(0, 4),
      invoice.kind === 'credit_note' ? 'CN' : '',
    )

    const command = invoiceEntryFor({
      entityId: context.entityId,
      journalCode: body.journalCode,
      issueDate: invoice.issueDate,
      invoiceNumber: number,
      receivableAccountNumber: body.receivableAccountNumber,
      isCreditNote: invoice.kind === 'credit_note',
      reference: invoice.reference,
      context: invoiceContext,
      priced,
    })

    const posted = await postJournalEntry(
      command,
      context.actor,
      {
        dryRun: false,
        idempotencyKey: `${idempotencyKey}:issue`,
        requestId: context.requestId,
        ip: context.ip,
        mayPostToSoftClosedPeriod: mayPostToSoftClosedPeriod(context),
      },
      { repository: ledger, clock: systemClock },
    )

    await sales.markIssued({ invoiceId, number, journalEntryId: posted.entry.id })

    return {
      status: 200,
      body: {
        id: invoiceId,
        number,
        status: 'issued',
        journalEntryId: posted.entry.id,
        ...serialisePriced(priced),
      },
    }
  })
}

export async function handleGetInvoice(context: RequestContext, invoiceId: string) {
  requirePermission(context, 'ledger:read')

  const invoice = await withSalesRead(context.database, (repository) =>
    repository.findInvoice(context.entityId, invoiceId),
  )
  if (invoice === null) throw new ApiError('not_found', `No invoice ${invoiceId}.`)

  return {
    status: 200,
    body: {
      invoice: {
        id: invoice.id,
        kind: invoice.kind,
        status: invoice.status,
        number: invoice.number,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        net: invoice.net.toString(),
        tax: invoice.tax.toString(),
        total: invoice.total.toString(),
        reference: invoice.reference,
        buyerReference: invoice.buyerReference,
        notes: invoice.notes,
        journalEntryId: invoice.journalEntryId,
        creditsInvoiceId: invoice.creditsInvoiceId,
        contact: {
          number: invoice.contactNumber,
          name: invoice.contactName,
          email: invoice.contactEmail,
          vatNumber: invoice.contactVatNumber,
          countryCode: invoice.contactCountry,
        },
        lines: invoice.lines.map((line) => ({
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.quantity,
          unitCode: line.unitCode,
          unitPrice: line.unitPrice.toString(),
          revenueAccountNumber: line.revenueAccountNumber,
          taxCode: line.taxCode,
          ratePercent: (line.taxRateBasisPoints / 100).toFixed(2),
          net: line.net.toString(),
          tax: line.tax.toString(),
        })),
      },
    },
  }
}

export async function handleListInvoices(
  context: RequestContext,
  query: { readonly status: 'draft' | 'issued' | 'cancelled' | null; readonly limit: number },
) {
  requirePermission(context, 'ledger:read')

  const rows = await withSalesRead(context.database, (repository) =>
    repository.listInvoices({
      entityId: context.entityId,
      status: query.status,
      limit: query.limit,
    }),
  )

  return {
    status: 200,
    body: {
      invoices: rows.map((invoice) => ({
        ...invoice,
        total: invoice.total.toString(),
      })),
    },
  }
}

export async function handleListOverdueInvoices(
  context: RequestContext,
  query: { readonly asOf: string },
) {
  requirePermission(context, 'ledger:read')

  const rows = await withSalesRead(context.database, (repository) =>
    repository.overdueInvoices(context.entityId, query.asOf),
  )

  const asOf = new Date(`${query.asOf}T00:00:00Z`).getTime()
  const dayMs = 86_400_000

  return {
    status: 200,
    body: {
      asOf: query.asOf,
      invoices: rows.map((invoice) => ({
        ...invoice,
        total: invoice.total.toString(),
        // Ageing, which is what dunning and the debtors report both want.
        daysOverdue: Math.floor(
          (asOf - new Date(`${invoice.dueDate}T00:00:00Z`).getTime()) / dayMs,
        ),
      })),
      totalOutstanding: rows.reduce((sum, invoice) => sum + invoice.total, 0n).toString(),
    },
  }
}

/**
 * The invoice as UBL 2.1, in the Peppol BIS Billing 3.0 shape (spec 7.5).
 *
 * "The XML is the legal invoice, the PDF is a rendering." So this is the
 * document, and it is refused rather than degraded: an invoice that breaks a
 * BIS or NLCIUS rule comes back as a 422 listing every rule it breaks, by its
 * official identifier. Handing somebody an invalid UBL that their customer's
 * system silently rejects is worse than handing them nothing.
 *
 * Drafts have no number, and a document with no BT-1 is not an invoice, so a
 * draft is a 404 here rather than a rule violation.
 */
/**
 * The invoice as UBL.
 *
 * ## The document is the bytes that were issued, not a re-derivation of them
 *
 * This used to regenerate the XML from the current database on every request,
 * which meant an invoice was whatever its inputs happened to say today. That is
 * fine while nothing can change, and contact editing is exactly the thing that
 * makes it not fine: correcting a customer's name would rewrite the invoice
 * sent to them last month, and `invoice_deliveries.document_hash` — the sha256
 * of what actually went out — would stop matching a document nobody could
 * reproduce.
 *
 * So the XML is generated once, when it is first asked for, and stored in the
 * content-addressed document store with a link to the invoice. Every later
 * request returns those bytes. Same doctrine as the pain.001, whose CreDtTm
 * comes from the approval rather than the clock (ADR 0027), and as the inbox
 * parse, which is stored rather than recomputed (ADR 0026): a record of what
 * happened does not move.
 *
 * Generation is still lazy rather than at issue time, because the schematron
 * gate below belongs to *sending* rather than to *issuing* — an invoice whose
 * seller address is missing is an invoice that has been correctly issued and
 * cannot yet be sent, and failing the issue would allocate no number and leave
 * a gap where the law wants none.
 */
/** Which CIUS a stored document declares. Its own `CustomizationID` is the answer. */
function profileOf(xml: string): UblProfile {
  return xml.includes(CUSTOMIZATION_ID.nlcius) ? 'nlcius' : 'peppol-bis-3'
}

export async function handleGetInvoiceUbl(context: RequestContext, invoiceId: string) {
  requirePermission(context, 'ledger:export')

  const source = await withSalesRead(context.database, (repository) =>
    repository.loadUblSource(context.entityId, invoiceId),
  )

  if (source === null) {
    throw new ApiError('not_found', 'No such issued invoice. A draft has no number yet.')
  }

  const stored = await withInboxRead(context.database, (repository) =>
    repository.documentsFor(context.entityId, 'sales_invoice', invoiceId),
  )
  const held = stored.find((entry) => entry.role === 'ubl')

  if (held !== undefined) {
    // Already issued and already written down. Nothing is regenerated, so
    // nothing can drift.
    const bytes = await documentStore().get(held.sha256)
    if (bytes !== null) {
      const xml = new TextDecoder().decode(bytes)
      const validation = schematron().validate(xml)
      return {
        xml,
        filename: `${source.number}.ubl.xml`,
        // Read out of the bytes rather than re-derived from today's settings,
        // for the same reason the bytes themselves are not re-derived.
        profile: profileOf(xml),
        warnings: validation.warnings.map((warning) => ({
          rule: warning.rule,
          message: warning.message,
        })),
        assertionsEvaluated: validation.assertionsEvaluated,
      }
    }
  }

  const document = toUblDocument(source)

  /**
   * Two layers, and they catch different things (the pattern from ADR 0012).
   *
   * The pre-flight runs on the document *before* it is generated and names the
   * field — `seller.address` — which is what a settings form can point at. The
   * schematron runs on the bytes afterwards and is the authority: it knows
   * about code lists, cross-field arithmetic and country profiles that no
   * hand-written subset would, and it is what the recipient's access point
   * will run.
   *
   * Doing only the first would ship documents that fail at the far end. Doing
   * only the second would tell a bookkeeper their invoice violates
   * `/Invoice/cac:AccountingSupplierParty/cac:Party` and leave them to work
   * out which box to type in.
   */
  const violations = checkUblRules(document)

  if (violations.length > 0) {
    throw new ApiError(
      'validation_failed',
      `This invoice breaks ${String(violations.length)} e-invoicing rule${violations.length === 1 ? '' : 's'}.`,
      violations.map((item) => ({
        code: item.rule,
        path: item.path,
        message: item.message,
      })),
    )
  }

  const xml = generateUbl(document)
  const validation = schematron().validate(xml)

  if (!validation.valid) {
    throw new ApiError(
      'validation_failed',
      `The schematron rejected this invoice: ${String(validation.failures.length)} rule${
        validation.failures.length === 1 ? '' : 's'
      } from ${validation.artefacts.join(' and ')}.`,
      validation.failures.map((failure) => ({
        code: failure.rule,
        path: failure.location,
        message: failure.message,
        detail: { artefact: failure.artefact, test: failure.test },
      })),
    )
  }

  // Written down now that it is known to be a document somebody could send.
  // The first request settles what this invoice is; every later one reads it.
  const put = await documentStore().put(new TextEncoder().encode(xml), {
    contentType: 'application/xml',
  })
  await withInbox(context.database, async ({ inbox }) => {
    const document = await inbox.recordDocument({
      entityId: context.entityId,
      sha256: put.sha256,
      sizeBytes: put.sizeBytes,
      contentType: 'application/xml',
      filename: `${source.number}.ubl.xml`,
    })
    await inbox.link({
      entityId: context.entityId,
      documentId: document.id,
      subjectKind: 'sales_invoice',
      subjectId: invoiceId,
      role: 'ubl',
    })
  })

  return {
    xml,
    filename: `${source.number}.ubl.xml`,
    profile: document.profile,
    /** Reported, not fatal. A warning is the artefact's own judgement call. */
    warnings: validation.warnings.map((warning) => ({
      rule: warning.rule,
      message: warning.message,
    })),
    assertionsEvaluated: validation.assertionsEvaluated,
  }
}

/**
 * The invoice as a PDF (spec 7.5).
 *
 * A rendering, not the invoice — the XML is that. So this is deliberately not
 * gated on the schematron: a bookkeeper printing a copy for a customer who
 * wants paper should not be stopped by a Peppol code-list rule.
 *
 * **Unless the UBL rides along.** `embedUbl` attaches the XML to the PDF, which
 * is spec 7.5's fallback transport — "email the UBL plus a PDF rendering, and
 * optionally a PDF with the XML embedded". At that point a machine will read
 * what is inside, so it has to be valid, and the same rules apply as to the
 * bare download.
 *
 * Not Factur-X or PDF/A-3: those want an ICC profile, an output intent and XMP
 * metadata as well, and claiming conformance without them would be a lie. The
 * attachment relationship is `Alternative`, which is the truthful part.
 */
export async function handleGetInvoicePdf(
  context: RequestContext,
  invoiceId: string,
  options: { readonly embedUbl: boolean },
) {
  requirePermission(context, 'ledger:export')

  const source = await withSalesRead(context.database, (repository) =>
    repository.loadUblSource(context.entityId, invoiceId),
  )

  if (source === null) {
    throw new ApiError('not_found', 'No such issued invoice. A draft has no number yet.')
  }

  let attachUbl: { filename: string; xml: string } | undefined
  if (options.embedUbl) {
    const ubl = await handleGetInvoiceUbl(context, invoiceId)
    attachUbl = { filename: ubl.filename, xml: ubl.xml }
  }

  const rendered = await invoiceRenderer().renderInvoice(presentInvoice(source), { attachUbl })

  return {
    bytes: rendered.bytes,
    contentType: rendered.contentType,
    filename: rendered.filename,
    embeddedUbl: attachUbl !== undefined,
  }
}

/**
 * Build the package that leaves the building: validated UBL, and a PDF.
 *
 * The UBL goes through the full pre-flight and schematron path — nothing is
 * sent that has not passed the published rules, which is the guarantee ADR 0017
 * exists to make good on. The PDF carries the XML inside it as well when asked,
 * so a recipient who saves only the attachment they recognise still has both.
 */
async function packageFor(
  context: RequestContext,
  invoiceId: string,
  options: { embedUbl: boolean; reminder?: { stage: number; daysOverdue: number } | undefined },
): Promise<{ document: EInvoiceDocument; hash: string }> {
  const source = await withSalesRead(context.database, (repository) =>
    repository.loadUblSource(context.entityId, invoiceId),
  )
  if (source === null) {
    throw new ApiError('not_found', 'No such issued invoice. A draft cannot be sent.')
  }

  const ubl = await handleGetInvoiceUbl(context, invoiceId)
  const pdf = await handleGetInvoicePdf(context, invoiceId, { embedUbl: options.embedUbl })

  return {
    hash: createHash('sha256').update(ubl.xml, 'utf8').digest('hex'),
    document: {
      invoiceNumber: source.number,
      kind: source.kind,
      xml: ubl.xml,
      xmlFilename: ubl.filename,
      pdf: { filename: pdf.filename, contentType: pdf.contentType, content: pdf.bytes },
      total: formatMinorUnits(source.total),
      currency: source.currency,
      dueDate: source.dueDate,
      sellerName: source.seller.tradingName ?? source.seller.legalName,
      ...(options.reminder === undefined ? {} : { reminder: options.reminder }),
    },
  }
}

function recipientFrom(
  source: {
    buyer: {
      legalName: string
      tradingName: string | null
      email: string | null
      electronicAddress: string | null
      electronicAddressScheme: string | null
      countryCode: string
    }
  },
  override: string | null,
) {
  return {
    name: source.buyer.tradingName ?? source.buyer.legalName,
    email: override ?? source.buyer.email,
    electronicAddress: source.buyer.electronicAddress,
    electronicAddressScheme: source.buyer.electronicAddressScheme,
    countryCode: source.buyer.countryCode,
  }
}

/**
 * Send an issued invoice (spec 7.5, 8).
 *
 * A send that fails is **recorded and reported, not thrown away**. Spec 8's
 * rule 4 — an adapter failing never blocks bookkeeping — means a bounced
 * message leaves the invoice exactly as it was and leaves a row saying what
 * happened, which is the answer to a customer who says they never got it.
 * The status code says which: 200 sent, 502 attempted and failed.
 */
export async function handleSendInvoice(
  context: RequestContext,
  invoiceId: string,
  body: SendInvoiceBody,
) {
  requirePermission(context, 'ledger:post')
  requireIdempotencyKey(context)

  const source = await withSalesRead(context.database, (repository) =>
    repository.loadUblSource(context.entityId, invoiceId),
  )
  if (source === null) {
    throw new ApiError('not_found', 'No such issued invoice. A draft cannot be sent.')
  }

  const { document, hash } = await packageFor(context, invoiceId, {
    embedUbl: body.embedUbl,
    reminder: undefined,
  })

  const transport = eInvoiceTransport()
  const recipient = recipientFrom(source, body.to)

  if (!(await transport.reachable(recipient))) {
    throw new ApiError(
      'validation_failed',
      `${recipient.name} has no email address. Add one to the contact, or pass "to".`,
      [{ code: 'unreachable_recipient', path: 'to', message: 'No address to send to.' }],
    )
  }

  const receipt = await transport.send(document, recipient)

  await withSales(context.database, ({ sales }) =>
    sales.recordDelivery({
      entityId: context.entityId,
      invoiceId,
      channel: receipt.channel,
      recipient: receipt.recipient,
      documentHash: hash,
      transport: receipt.transport,
      transportMessageId: receipt.messageId,
      delivered: receipt.delivered,
      failure: receipt.failure,
      purpose: 'invoice',
      dunningStage: null,
    }),
  )

  return {
    status: receipt.failure === null ? 200 : 502,
    body: {
      invoiceId,
      number: document.invoiceNumber,
      channel: receipt.channel,
      transport: receipt.transport,
      recipient: receipt.recipient,
      delivered: receipt.delivered,
      messageId: receipt.messageId,
      failure: receipt.failure,
      documentHash: hash,
    },
  }
}

export async function handleListDeliveries(context: RequestContext, invoiceId: string) {
  requirePermission(context, 'ledger:read')

  const rows = await withSalesRead(context.database, (repository) =>
    repository.deliveriesFor(context.entityId, invoiceId),
  )

  return {
    status: 200,
    body: {
      deliveries: rows.map((row) => ({
        ...row,
        sentAt: row.sentAt.toISOString(),
        stageLabel: row.dunningStage === null ? null : (stageOf(row.dunningStage)?.label ?? null),
      })),
    },
  }
}

export async function handleGetDunningQueue(
  context: RequestContext,
  query: { readonly asOf: string },
) {
  requirePermission(context, 'ledger:read')

  const invoices = await withSalesRead(context.database, (repository) =>
    repository.dunnable(context.entityId, query.asOf),
  )
  const actions = planDunning(invoices, query.asOf)

  return {
    status: 200,
    body: {
      asOf: query.asOf,
      schedule: DEFAULT_DUNNING_SCHEDULE,
      actions: actions.map((action) => ({
        invoiceId: action.invoiceId,
        number: action.number,
        contactName: action.contactName,
        contactEmail: action.contactEmail,
        total: action.total.toString(),
        currency: action.currency,
        dueDate: action.dueDate,
        daysOverdue: action.daysOverdue,
        stage: action.stage.stage,
        stageLabel: action.stage.label,
        tone: action.stage.tone,
        sendable: action.sendable,
      })),
      totalOverdue: actions.reduce((sum, action) => sum + action.total, 0n).toString(),
    },
  }
}

/**
 * Send the reminder this invoice is due.
 *
 * The stage is **derived here, not chosen by the caller** — a screen that has
 * been open for an hour would otherwise send stage 1 to an invoice that has
 * moved on to stage 2. `expectedStage` lets the caller say what it thought, and
 * a mismatch is a 409 rather than the wrong letter going out.
 *
 * One reminder per stage, ever, enforced by `planDunning`: an invoice with
 * nothing due has no action, and asking again is a 409 rather than a duplicate.
 */
export async function handleSendDunningReminder(
  context: RequestContext,
  invoiceId: string,
  body: SendReminderBody,
) {
  requirePermission(context, 'ledger:post')
  requireIdempotencyKey(context)

  const invoices = await withSalesRead(context.database, (repository) =>
    repository.dunnable(context.entityId, body.asOf),
  )
  const action = planDunning(invoices, body.asOf).find((item) => item.invoiceId === invoiceId)

  if (action === undefined) {
    throw new ApiError(
      'conflict',
      'This invoice has no reminder due: it is not overdue far enough, or the reminder has already been sent.',
    )
  }
  if (body.expectedStage !== null && body.expectedStage !== action.stage.stage) {
    throw new ApiError(
      'conflict',
      `This invoice is now due a stage ${String(action.stage.stage)} reminder, not stage ${String(body.expectedStage)}. Reload and try again.`,
    )
  }

  const source = await withSalesRead(context.database, (repository) =>
    repository.loadUblSource(context.entityId, invoiceId),
  )
  if (source === null) throw new ApiError('not_found', 'The invoice has gone.')

  const { document, hash } = await packageFor(context, invoiceId, {
    embedUbl: true,
    reminder: { stage: action.stage.stage, daysOverdue: action.daysOverdue },
  })

  const transport = eInvoiceTransport()
  const recipient = recipientFrom(source, null)
  const receipt = await transport.send(document, recipient)

  await withSales(context.database, ({ sales }) =>
    sales.recordDelivery({
      entityId: context.entityId,
      invoiceId,
      channel: receipt.channel,
      recipient: receipt.recipient,
      documentHash: hash,
      transport: receipt.transport,
      transportMessageId: receipt.messageId,
      delivered: receipt.delivered,
      failure: receipt.failure,
      purpose: 'reminder',
      dunningStage: action.stage.stage,
    }),
  )

  return {
    status: receipt.failure === null ? 200 : 502,
    body: {
      invoiceId,
      number: action.number,
      stage: action.stage.stage,
      stageLabel: action.stage.label,
      daysOverdue: action.daysOverdue,
      recipient: receipt.recipient,
      delivered: receipt.delivered,
      transport: receipt.transport,
      messageId: receipt.messageId,
      failure: receipt.failure,
    },
  }
}
