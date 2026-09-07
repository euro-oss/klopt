import {
  checkUblRules,
  generateUbl,
  postJournalEntry,
  presentInvoice,
  systemClock,
  toUblDocument,
  type PricedInvoice,
} from '@klopt/core'
import {
  invoiceEntryFor,
  priceDraft,
  withSales,
  withSalesRead,
  type DraftInvoiceRequest,
} from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { invoiceRenderer } from '../documents.js'
import { schematron } from '../schematron.js'
import type { CreateContactBody, DraftInvoiceBody, IssueInvoiceBody } from '../schemas.js'

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
export async function handleGetInvoiceUbl(context: RequestContext, invoiceId: string) {
  requirePermission(context, 'ledger:export')

  const source = await withSalesRead(context.database, (repository) =>
    repository.loadUblSource(context.entityId, invoiceId),
  )

  if (source === null) {
    throw new ApiError('not_found', 'No such issued invoice. A draft has no number yet.')
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
