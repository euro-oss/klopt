import {
  assertBookable,
  buildPurchaseEntry,
  checkPurchaseInvoice,
  isPayable,
  nextPurchaseStatus,
  payableRefusal,
  postJournalEntry,
  purchaseStatusLabel,
  systemClock,
  type PurchaseFinding,
  type PurchaseInvoiceInput,
} from '@klopt/core'
import { withPurchase, withPurchaseRead } from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import type {
  BookPurchaseInvoiceBody,
  CapturePurchaseInvoiceBody,
  TransitionPurchaseInvoiceBody,
} from '../schemas.js'

/**
 * Purchase invoices over HTTP.
 *
 * The pattern is the same as everywhere: resolve permission, load, call
 * `@klopt/core`, serialise. The one thing worth reading is that `check` runs on
 * every read, not only before booking — a captured invoice goes stale when a
 * tax code's validity window closes or when the same number arrives twice, and
 * a finding that only appeared at the moment of booking would appear too late.
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

function serialiseFinding(finding: PurchaseFinding) {
  return {
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    lineNumber: finding.lineNumber,
    amount: finding.amountMinorUnits.toString(),
  }
}

function toInput(body: CapturePurchaseInvoiceBody): PurchaseInvoiceInput {
  return {
    supplierInvoiceNumber: body.supplierInvoiceNumber,
    kind: body.kind,
    invoiceDate: body.invoiceDate,
    dueDate: body.dueDate,
    currency: body.currency,
    netMinorUnits: BigInt(body.net),
    taxMinorUnits: BigInt(body.tax),
    totalMinorUnits: BigInt(body.total),
    lines: body.lines.map((line) => ({
      description: line.description,
      accountNumber: line.accountNumber,
      taxCode: line.taxCode,
      netMinorUnits: BigInt(line.net),
      taxMinorUnits: BigInt(line.tax),
    })),
  }
}

export async function handleListPurchaseInvoices(
  context: RequestContext,
  query: { readonly status?: string | undefined; readonly openOnly?: boolean | undefined },
) {
  requirePermission(context, 'ledger:read')

  return withPurchaseRead(context.database, async (repository) => {
    const rows = await repository.list(context.entityId, {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.openOnly === undefined ? {} : { openOnly: query.openOnly }),
    })

    return {
      status: 200,
      body: {
        invoices: rows.map((row) => ({
          id: row.id,
          status: row.status,
          statusLabel: purchaseStatusLabel(row.status),
          kind: row.kind,
          supplierInvoiceNumber: row.supplierInvoiceNumber,
          contactNumber: row.contactNumber,
          contactName: row.contactName,
          invoiceDate: row.invoiceDate,
          dueDate: row.dueDate,
          currency: row.currency,
          net: row.net.toString(),
          tax: row.tax.toString(),
          total: row.total.toString(),
          outstanding: row.outstanding.toString(),
          // Committed to a payment instruction but not yet paid. Still owed —
          // it is only out of the *next* run, not out of the ageing.
          scheduled: row.scheduled.toString(),
          payable: isPayable(row.status),
          payableRefusal: payableRefusal(row.status),
          journalEntryId: row.journalEntryId,
          disputedReason: row.disputedReason,
        })),
        // What is waiting for somebody, which is what the list is for.
        awaitingApproval: rows.filter((row) => row.status === 'booked').length,
        drafts: rows.filter((row) => row.status === 'draft').length,
      },
    }
  })
}

export async function handleGetPurchaseInvoice(context: RequestContext, invoiceId: string) {
  requirePermission(context, 'ledger:read')

  return withPurchaseRead(context.database, async (repository) => {
    const found = await repository.load(context.entityId, invoiceId)
    if (found === null) throw new ApiError('not_found', `No purchase invoice ${invoiceId}.`)

    const outerContext = await repository.loadContext(context.entityId, found.row.contactNumber)
    // Recomputed on every read: a capture goes stale when a tax code's window
    // closes or the same number arrives twice, and a finding that only showed
    // up at booking would show up too late.
    const findings =
      outerContext === null
        ? []
        : checkPurchaseInvoice({
            invoice: found.invoice,
            rules: outerContext.rules,
            isDuplicate: await repository.isDuplicate(
              context.entityId,
              found.contactId,
              found.invoice.supplierInvoiceNumber,
              invoiceId,
            ),
          })

    const entryNumber =
      found.row.journalEntryId === null
        ? null
        : await repository.entryNumberFor(context.entityId, found.row.journalEntryId)

    return {
      status: 200,
      body: {
        id: found.row.id,
        status: found.row.status,
        statusLabel: purchaseStatusLabel(found.row.status),
        kind: found.row.kind,
        supplierInvoiceNumber: found.row.supplierInvoiceNumber,
        contactNumber: found.row.contactNumber,
        contactName: found.row.contactName,
        invoiceDate: found.row.invoiceDate,
        dueDate: found.row.dueDate,
        currency: found.row.currency,
        net: found.row.net.toString(),
        tax: found.row.tax.toString(),
        total: found.row.total.toString(),
        allocated: found.row.allocated.toString(),
        outstanding: found.row.outstanding.toString(),
        scheduled: found.row.scheduled.toString(),
        paymentReference: found.row.paymentReference,
        journalEntryId: found.row.journalEntryId,
        journalEntryNumber: entryNumber,
        bookedBy: found.row.bookedBy,
        approvedBy: found.row.approvedBy,
        disputedReason: found.row.disputedReason,
        payable: isPayable(found.row.status),
        payableRefusal: payableRefusal(found.row.status),
        lines: found.invoice.lines.map((line, index) => ({
          lineNumber: index + 1,
          description: line.description,
          accountNumber: line.accountNumber,
          taxCode: line.taxCode,
          net: line.netMinorUnits.toString(),
          tax: line.taxMinorUnits.toString(),
        })),
        findings: findings.map(serialiseFinding),
        bookable: !findings.some((finding) => finding.severity === 'blocking'),
      },
    }
  })
}

export async function handleCapturePurchaseInvoice(
  context: RequestContext,
  body: CapturePurchaseInvoiceBody,
) {
  // `ledger:draft`, not `ledger:post`. Creating a draft is the half an agent
  // may do; issuing, booking and sending are the release. `grants` lets
  // `ledger:post` satisfy this, so nothing that could already draft stopped.
  requirePermission(context, 'ledger:draft')
  requireIdempotencyKey(context)

  return withPurchase(context.database, async ({ purchase }) => {
    const invoiceContext = await purchase.loadContext(context.entityId, body.contactNumber)
    if (invoiceContext === null) {
      throw new ApiError('not_found', `No contact ${body.contactNumber}.`)
    }
    if (invoiceContext.contact.isBlocked) {
      throw new ApiError(
        'validation_failed',
        `${invoiceContext.contact.name} is blocked. Unblock the contact before booking against it.`,
      )
    }

    const invoice = toInput(body)

    for (const line of invoice.lines) {
      if (!invoiceContext.accountIdByNumber.has(line.accountNumber)) {
        throw new ApiError('validation_failed', `No account ${line.accountNumber}.`)
      }
      if (!invoiceContext.taxCodeIdByCode.has(line.taxCode)) {
        throw new ApiError('validation_failed', `No tax code ${line.taxCode}.`)
      }
    }

    // The one finding that cannot be a note on a saved draft: the unique index
    // on (entity, supplier, number) will not hold two, and it should not — a
    // double-booked invoice is a double payment. Refused here with the number
    // named, which is more use than a second copy to cancel.
    if (
      await purchase.isDuplicate(
        context.entityId,
        invoiceContext.contact.id,
        invoice.supplierInvoiceNumber,
      )
    ) {
      throw new ApiError(
        'conflict',
        `${invoiceContext.contact.name} has already sent invoice ${invoice.supplierInvoiceNumber}. Booking it twice is how an invoice gets paid twice — open the one that is already here.`,
      )
    }

    const findings = checkPurchaseInvoice({
      invoice,
      rules: invoiceContext.rules,
      isDuplicate: false,
    })

    // Everything else is captured, findings and all: a draft that cannot be
    // saved is a draft somebody retypes, and a warning is something to look at
    // rather than a reason to refuse. Booking is where the refusal belongs.
    const id = await purchase.createDraft({
      entityId: context.entityId,
      contactId: invoiceContext.contact.id,
      invoice,
      paymentReference: body.paymentReference,
      notes: body.notes,
      taxCodeIdByCode: invoiceContext.taxCodeIdByCode,
      accountIdByNumber: invoiceContext.accountIdByNumber,
    })

    await recordAudit(context, {
      action: 'purchase.capture',
      resourceType: 'purchase_invoice',
      resourceId: id,
      after: {
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        contactNumber: body.contactNumber,
        total: invoice.totalMinorUnits.toString(),
      },
    })

    return {
      status: 201,
      body: {
        id,
        status: 'draft',
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        total: invoice.totalMinorUnits.toString(),
        findings: findings.map(serialiseFinding),
        bookable: !findings.some((finding) => finding.severity === 'blocking'),
      },
    }
  })
}

export async function handleBookPurchaseInvoice(
  context: RequestContext,
  invoiceId: string,
  body: BookPurchaseInvoiceBody,
) {
  requirePermission(context, 'ledger:post')
  const idempotencyKey = requireIdempotencyKey(context)

  return withPurchase(context.database, async ({ purchase, ledger }) => {
    const found = await purchase.load(context.entityId, invoiceId)
    if (found === null) throw new ApiError('not_found', `No purchase invoice ${invoiceId}.`)

    // Refuses unless the invoice is a draft, and says what it would accept.
    nextPurchaseStatus('book', found.row.status, {
      userId: context.actor.id,
      actorKind: context.actor.kind === 'agent' ? 'agent' : context.actor.kind,
    })

    const invoiceContext = await purchase.loadContext(context.entityId, found.row.contactNumber)
    if (invoiceContext === null) {
      throw new ApiError('not_found', `No contact ${found.row.contactNumber}.`)
    }
    if (invoiceContext.payableAccountNumber === null) {
      throw new ApiError(
        'validation_failed',
        'This chart has no creditors control account, so there is nowhere to post the liability. Map one to RGS BSchCre.',
      )
    }

    // Every reason at once, as a 422. The capture is what gets refused, not the
    // supplier's arithmetic — see packages/core/src/purchase/check.ts.
    assertBookable(
      checkPurchaseInvoice({
        invoice: found.invoice,
        rules: invoiceContext.rules,
        isDuplicate: await purchase.isDuplicate(
          context.entityId,
          found.contactId,
          found.invoice.supplierInvoiceNumber,
          invoiceId,
        ),
      }),
    )

    const command = buildPurchaseEntry(
      {
        entityId: context.entityId,
        journalCode: 'INK',
        /**
         * The invoice's own date by default, not today.
         *
         * The liability arises when the invoice is dated and its VAT is
         * deductible in that period, so booking it there is the answer that
         * needs no thought. An override exists because a January invoice that
         * turns up in April lands in a period the aangifte has closed, and the
         * operator — not this handler — decides whether that becomes a
         * suppletie or a current-period booking.
         */
        bookingDate: body.bookingDate ?? found.invoice.invoiceDate,
        contactNumber: invoiceContext.contact.number,
        contactName: invoiceContext.contact.name,
        contactId: invoiceContext.contact.id,
        payableAccountNumber: invoiceContext.payableAccountNumber,
        invoice: found.invoice,
      },
      invoiceContext.rules,
      (code) => invoiceContext.taxAccountByCode.get(code) ?? null,
    )

    const posted = await postJournalEntry(
      command,
      context.actor,
      {
        dryRun: false,
        idempotencyKey: `${idempotencyKey}:book`,
        requestId: context.requestId,
        ip: context.ip,
        mayPostToSoftClosedPeriod: mayPostToSoftClosedPeriod(context),
      },
      { repository: ledger, clock: systemClock },
    )

    await purchase.markBooked({
      entityId: context.entityId,
      invoiceId,
      journalEntryId: posted.entry.id,
      actorId: context.actor.id,
    })

    // The journal entry has its own audit row, written inside the posting
    // transaction. This one is about the invoice: which document became which
    // entry, which is the join an inspector follows.
    await recordAudit(context, {
      action: 'purchase.book',
      resourceType: 'purchase_invoice',
      resourceId: invoiceId,
      before: { status: found.row.status },
      after: {
        status: 'booked',
        journalEntryId: posted.entry.id,
        journalEntryNumber: String(posted.entry.entryNumber),
      },
    })

    return {
      status: 200,
      body: {
        id: invoiceId,
        status: 'booked',
        journalEntryId: posted.entry.id,
        journalEntryNumber: String(posted.entry.entryNumber),
        total: found.invoice.totalMinorUnits.toString(),
      },
    }
  })
}

export async function handleTransitionPurchaseInvoice(
  context: RequestContext,
  invoiceId: string,
  body: TransitionPurchaseInvoiceBody,
) {
  requirePermission(context, 'purchase:approve')
  requireIdempotencyKey(context)

  return withPurchase(context.database, async ({ purchase }) => {
    const found = await purchase.load(context.entityId, invoiceId)
    if (found === null) throw new ApiError('not_found', `No purchase invoice ${invoiceId}.`)

    const transition = nextPurchaseStatus(body.action, found.row.status, {
      userId: context.actor.id,
      actorKind: context.actor.kind === 'agent' ? 'agent' : context.actor.kind,
    })

    if (transition.to === 'disputed' && (body.reason ?? '').trim() === '') {
      throw new ApiError(
        'validation_failed',
        'A dispute needs a reason. It is what the supplier gets told and what the next person reads.',
      )
    }

    await purchase.transition({
      entityId: context.entityId,
      invoiceId,
      to: transition.to as 'approved' | 'disputed' | 'booked' | 'cancelled',
      actorId: context.actor.id,
      reason: body.reason,
    })

    // Approving a cost is an authorisation, and an authorisation nobody can
    // point at afterwards is not one.
    await recordAudit(context, {
      action: `purchase.${body.action}`,
      resourceType: 'purchase_invoice',
      resourceId: invoiceId,
      before: { status: transition.from },
      after: { status: transition.to, reason: body.reason ?? null },
    })

    return {
      status: 200,
      body: {
        id: invoiceId,
        from: transition.from,
        status: transition.to,
        statusLabel: purchaseStatusLabel(transition.to),
        payable: isPayable(transition.to),
      },
    }
  })
}

/**
 * Aged creditors, with the subledger reconciled to its control account.
 *
 * Spec 9.2 wants the reconciliation as a scheduled check with an alert on
 * drift. It is on the report as well, because a bookkeeper who cannot see the
 * number will not trust the alert when it fires.
 */
export async function handleGetCreditorAgeing(
  context: RequestContext,
  query: { readonly asOf: string },
) {
  requirePermission(context, 'ledger:read')

  return withPurchaseRead(context.database, async (repository) => {
    const buckets = await repository.ageing(context.entityId, query.asOf)
    const payableAccountNumber = await repository.payableAccountNumber(context.entityId)

    if (payableAccountNumber === null) {
      throw new ApiError(
        'validation_failed',
        'This chart has no creditors control account, so there is nothing to reconcile against. Map one to RGS BSchCre.',
      )
    }

    const reconciliation = await repository.reconcileToControlAccount(
      context.entityId,
      payableAccountNumber,
    )

    return {
      status: 200,
      body: {
        asOf: query.asOf,
        payableAccountNumber,
        buckets: buckets.map((bucket) => ({
          contactNumber: bucket.contactNumber,
          contactName: bucket.contactName,
          current: bucket.current.toString(),
          upTo30: bucket.upTo30.toString(),
          upTo60: bucket.upTo60.toString(),
          upTo90: bucket.upTo90.toString(),
          over90: bucket.over90.toString(),
          total: bucket.total.toString(),
        })),
        total: buckets.reduce((sum, bucket) => sum + bucket.total, 0n).toString(),
        reconciliation: {
          subledger: reconciliation.subledger.toString(),
          controlAccount: reconciliation.control.toString(),
          difference: reconciliation.difference.toString(),
          reconciles: reconciliation.difference === 0n,
        },
      },
    }
  })
}
