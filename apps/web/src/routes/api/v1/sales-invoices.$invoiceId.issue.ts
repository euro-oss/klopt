import { createFileRoute } from '@tanstack/react-router'
import { handleIssueInvoice } from '~/api/handlers/sales'
import { issueInvoiceBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Numbering and posting are one step, deliberately. An invoice number issued
 * without a journal entry behind it is a gap somebody has to explain.
 */
export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId/issue')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleIssueInvoice(
            context,
            params.invoiceId,
            parse(issueInvoiceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
