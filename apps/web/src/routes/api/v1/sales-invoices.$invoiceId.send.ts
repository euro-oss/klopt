import { createFileRoute } from '@tanstack/react-router'
import { handleSendInvoice } from '~/api/handlers/sales'
import { sendInvoiceBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Send it. 200 when it went, 502 when it was attempted and failed — and either
 * way a delivery row records what happened (spec 8, rule 3).
 */
export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId/send')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleSendInvoice(
            context,
            params.invoiceId,
            parse(sendInvoiceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
