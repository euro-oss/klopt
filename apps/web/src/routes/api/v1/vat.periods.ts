import { createFileRoute } from '@tanstack/react-router'
import { handleListVatPeriods } from '~/api/handlers/vat'
import { handle, parse } from '~/api/runtime'
import { listVatPeriodsQuery } from '~/api/schemas'

/**
 * The declaration periods of a year, with each one's deadline and whether it
 * has been filed. Monthly, quarterly or annual, per the entity's setting.
 */
export const Route = createFileRoute('/api/v1/vat/periods')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) => {
          const url = new URL(request.url)
          const query = parse(
            listVatPeriodsQuery,
            { year: url.searchParams.get('year') ?? String(new Date().getUTCFullYear()) },
            'The query string',
          )
          return handleListVatPeriods(context, query)
        }),
    },
  },
})
