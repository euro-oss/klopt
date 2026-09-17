import { createFileRoute } from '@tanstack/react-router'
import { handleAddApprovedInvoices, handlePreviewPaymentRun } from '~/api/handlers/payments'
import { handle } from '~/api/runtime'

/**
 * The payment run: what is approved and unpaid, and putting it in a batch.
 *
 * GET previews and POST commits, because a run somebody cannot look at before
 * pressing the button is a run they press the button on twice.
 */
export const Route = createFileRoute('/api/v1/payment-batches/$batchId/run')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handlePreviewPaymentRun(context, params.batchId)),
      POST: ({ request, params }) =>
        handle(request, (context) => handleAddApprovedInvoices(context, params.batchId)),
    },
  },
})
