import { createFileRoute } from '@tanstack/react-router'
import { handleGetIcp } from '~/api/handlers/vat'
import { handle } from '~/api/runtime'

/**
 * The ICP opgaaf for a period, per counterparty, with each number's VIES proof
 * and the cross-check against rubriek 3b. A mismatch blocks (spec 7.2).
 */
export const Route = createFileRoute('/api/v1/vat/icp/$period')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(request, (context) => handleGetIcp(context, params.period)),
    },
  },
})
