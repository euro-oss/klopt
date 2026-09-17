import { createFileRoute } from '@tanstack/react-router'
import { handleTransitionPurchaseInvoice } from '~/api/handlers/purchase'
import { transitionPurchaseInvoiceBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Approve, dispute or resolve. Approval gates payment, not the ledger. */
export const Route = createFileRoute('/api/v1/purchase-invoices/$invoiceId/transitions')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleTransitionPurchaseInvoice(
            context,
            params.invoiceId,
            parse(transitionPurchaseInvoiceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
