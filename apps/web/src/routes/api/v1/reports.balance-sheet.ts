import { createFileRoute } from '@tanstack/react-router'
import { handleGetBalanceSheet } from '~/api/handlers/compliance'
import { statementQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/reports/balance-sheet')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleGetBalanceSheet(
            context,
            parse(statementQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
