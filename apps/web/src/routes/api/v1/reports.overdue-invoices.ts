import { createFileRoute } from '@tanstack/react-router'
import { handleListOverdueInvoices } from '~/api/handlers/sales'
import { overdueQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/reports/overdue-invoices')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleListOverdueInvoices(
            context,
            parse(overdueQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
