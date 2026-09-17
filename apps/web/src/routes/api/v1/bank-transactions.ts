import { createFileRoute } from '@tanstack/react-router'
import { handleListBankTransactions } from '~/api/handlers/bank'
import { transactionsQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/** The statement lines, filterable by account and by match status. */
export const Route = createFileRoute('/api/v1/bank-transactions')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleListBankTransactions(
            context,
            parse(transactionsQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
