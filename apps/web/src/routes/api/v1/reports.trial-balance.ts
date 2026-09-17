import { createFileRoute } from '@tanstack/react-router'
import { handleGetTrialBalance } from '~/api/handlers/ledger'
import { trialBalanceQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/reports/trial-balance')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleGetTrialBalance(
            context,
            parse(trialBalanceQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
