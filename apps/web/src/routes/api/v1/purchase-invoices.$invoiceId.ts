import { createFileRoute } from '@tanstack/react-router'
import { handleGetPurchaseInvoice } from '~/api/handlers/purchase'
import { handle } from '~/api/runtime'

/**
 * One purchase invoice, with its findings recomputed on every read: a capture
 * goes stale when a tax code's window closes or the same number arrives twice.
 */
export const Route = createFileRoute('/api/v1/purchase-invoices/$invoiceId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetPurchaseInvoice(context, params.invoiceId)),
    },
  },
})
