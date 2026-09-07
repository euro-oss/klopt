import { createFileRoute } from '@tanstack/react-router'
import { handleCapturePurchaseInvoice, handleListPurchaseInvoices } from '~/api/handlers/purchase'
import { capturePurchaseInvoiceBody } from '~/api/schemas'
import { handle, parse, readJson, searchParams } from '~/api/runtime'

/** Purchase invoices, and capturing one. */
export const Route = createFileRoute('/api/v1/purchase-invoices')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) => {
          const query = searchParams(request)
          return handleListPurchaseInvoices(context, {
            status: typeof query['status'] === 'string' ? query['status'] : undefined,
            openOnly: query['openOnly'] === 'true',
          })
        }),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCapturePurchaseInvoice(
            context,
            parse(capturePurchaseInvoiceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
