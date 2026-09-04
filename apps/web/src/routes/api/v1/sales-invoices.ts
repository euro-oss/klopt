import { createFileRoute } from '@tanstack/react-router'
import { handleDraftInvoice, handleListInvoices } from '~/api/handlers/sales'
import { draftInvoiceBody, invoicesQuery } from '~/api/schemas'
import { handle, parse, readJson, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/sales-invoices')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleListInvoices(
            context,
            parse(invoicesQuery, searchParams(request), 'The query string'),
          ),
        ),

      POST: ({ request }) =>
        handle(request, async (context) =>
          handleDraftInvoice(
            context,
            parse(draftInvoiceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
