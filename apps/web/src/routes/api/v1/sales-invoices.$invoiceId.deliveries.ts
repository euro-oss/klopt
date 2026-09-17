import { createFileRoute } from '@tanstack/react-router'
import { handleListDeliveries } from '~/api/handlers/sales'
import { handle } from '~/api/runtime'

/** The evidence chain for one invoice: what went out, when, and to whom. */
export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId/deliveries')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleListDeliveries(context, params.invoiceId)),
    },
  },
})
