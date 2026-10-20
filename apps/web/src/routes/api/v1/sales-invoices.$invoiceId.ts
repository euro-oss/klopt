import { createFileRoute } from '@tanstack/react-router'
import { handleGetInvoice, handleReplaceDraftInvoice } from '~/api/handlers/sales'
import { draftInvoiceBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * One sales invoice: read it, or replace a draft in place.
 *
 * `PUT` rather than `PATCH`: a draft rewrite always sends the full body (same
 * shape as `POST /sales-invoices`), so there is no partial-update ambiguity.
 * Issued invoices refuse the write — the number has been given out.
 */
export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetInvoice(context, params.invoiceId)),
      PUT: ({ request, params }) =>
        handle(request, async (context) =>
          handleReplaceDraftInvoice(
            context,
            params.invoiceId,
            parse(draftInvoiceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
