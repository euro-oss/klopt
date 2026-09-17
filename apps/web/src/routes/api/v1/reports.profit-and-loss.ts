import { createFileRoute } from '@tanstack/react-router'
import { handleGetProfitAndLoss } from '~/api/handlers/compliance'
import { statementQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/reports/profit-and-loss')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleGetProfitAndLoss(
            context,
            parse(statementQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
