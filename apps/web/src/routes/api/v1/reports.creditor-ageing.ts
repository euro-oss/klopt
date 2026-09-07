import { createFileRoute } from '@tanstack/react-router'
import { handleGetCreditorAgeing } from '~/api/handlers/purchase'
import { creditorAgeingQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * Aged creditors, with the subledger reconciled to its control account. The
 * reconciliation is on the report as well as in the scheduled check, because a
 * bookkeeper who cannot see the number will not trust the alert.
 */
export const Route = createFileRoute('/api/v1/reports/creditor-ageing')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleGetCreditorAgeing(
            context,
            parse(creditorAgeingQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
