import { createFileRoute } from '@tanstack/react-router'
import { handleGetVatReturn } from '~/api/handlers/vat'
import { handle } from '~/api/runtime'

/**
 * The BTW-aangifte for a period, recomputed from the journal on every read,
 * with the reconciliation and every line behind every rubriek.
 */
export const Route = createFileRoute('/api/v1/vat/returns/$period')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetVatReturn(context, params.period)),
    },
  },
})
