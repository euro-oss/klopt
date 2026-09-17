import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, summarise, type Answer } from '../provenance.js'

/**
 * `list_pending_approvals` — "What is waiting for a human" (spec 10.3).
 *
 * The tool that makes the proposal model usable. If writes become drafts a
 * human releases, then somebody has to be able to ask what is sitting in the
 * queue — and an agent that can see the queue can chase it, summarise it and
 * explain what each item is, without being able to release any of it.
 *
 * Three queues, because that is how many there are: purchase invoices booked
 * but not approved, documents in the inbox nobody has turned into anything,
 * and payment batches waiting for a second pair of eyes.
 */

export const listPendingApprovalsInput = z.object({
  limit: z.number().int().min(1).max(200).optional(),
})

interface PurchaseInvoice {
  readonly id: string
  readonly supplierInvoiceNumber: string | null
  readonly contactName?: string
  readonly status: string
  readonly dueDate: string
  readonly totalMinorUnits?: string
  readonly total?: string
}

interface InboxItem {
  readonly id: string
  readonly state: string
  readonly subject?: string | null
  readonly receivedAt?: string
}

interface PaymentBatch {
  readonly id: string
  readonly status: string
  readonly reference?: string | null
  readonly total?: string
}

export async function listPendingApprovals(
  context: ToolContext,
  input: z.infer<typeof listPendingApprovalsInput>,
): Promise<Answer<Record<string, unknown>>> {
  const sources = ['/api/v1/purchase-invoices', '/api/v1/inbox', '/api/v1/payment-batches']

  const [purchase, inbox, batches] = await Promise.all([
    context.api.get<{ invoices: PurchaseInvoice[] }>('/purchase-invoices'),
    context.api.get<{ items: InboxItem[] }>('/inbox'),
    context.api.get<{ batches: PaymentBatch[] }>('/payment-batches'),
  ])

  // `booked` is the state that means "a liability we have accepted and nobody
  // has authorised for payment". `disputed` is waiting on a human too, but on a
  // conversation with the supplier rather than on an approval.
  const awaitingApproval = purchase.invoices.filter((invoice) => invoice.status === 'booked')
  const disputed = purchase.invoices.filter((invoice) => invoice.status === 'disputed')
  const unfiled = inbox.items.filter((item) => item.state !== 'filed' && item.state !== 'discarded')
  const unsent = batches.batches.filter(
    (batch) => batch.status !== 'exported' && batch.status !== 'cancelled',
  )

  const capped = summarise(awaitingApproval, input.limit)

  return answer(
    await context.provenance(sources),
    {
      purchaseInvoices: {
        awaitingApproval: awaitingApproval.length,
        disputed: disputed.length,
        items: capped.rows.map((invoice) => ({
          invoiceId: invoice.id,
          supplierNumber: invoice.supplierInvoiceNumber,
          supplier: invoice.contactName,
          dueDate: invoice.dueDate,
          drillDown: `GET /api/v1/purchase-invoices/${invoice.id}`,
        })),
      },
      inbox: {
        waiting: unfiled.length,
        items: summarise(unfiled, 10).rows.map((item) => ({
          itemId: item.id,
          state: item.state,
          subject: item.subject ?? null,
          drillDown: `GET /api/v1/inbox`,
        })),
      },
      paymentBatches: {
        open: unsent.length,
        items: summarise(unsent, 10).rows.map((batch) => ({
          batchId: batch.id,
          status: batch.status,
          drillDown: `GET /api/v1/payment-batches/${batch.id}`,
        })),
      },
    },
    capped.truncated,
  )
}
