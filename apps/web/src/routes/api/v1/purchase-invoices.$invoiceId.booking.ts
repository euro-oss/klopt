import { createFileRoute } from '@tanstack/react-router'
import { handleBookPurchaseInvoice } from '~/api/handlers/purchase'
import { bookPurchaseInvoiceBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Put a captured invoice in the books. The liability and the deductible VAT are
 * recognised at the invoice's own date, which is where they belong.
 */
export const Route = createFileRoute('/api/v1/purchase-invoices/$invoiceId/booking')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleBookPurchaseInvoice(
            context,
            params.invoiceId,
            parse(bookPurchaseInvoiceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
