import { postJournalEntry, systemClock, type PricedInvoice } from '@klopt/core'
import {
  invoiceEntryFor,
  priceDraft,
  withSales,
  withSalesRead,
  type DraftInvoiceRequest,
} from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
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
