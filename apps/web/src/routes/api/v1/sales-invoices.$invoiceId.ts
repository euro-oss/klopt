import { createFileRoute } from '@tanstack/react-router'
import { handleGetInvoice } from '~/api/handlers/sales'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetInvoice(context, params.invoiceId)),
    },
  },
})
