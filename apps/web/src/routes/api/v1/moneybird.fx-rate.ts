import { createFileRoute } from '@tanstack/react-router'
import { handleMoneybirdFxRate } from '~/api/handlers/moneybird'
import { moneybirdFxRateQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/moneybird/fx-rate')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, async (context) =>
          handleMoneybirdFxRate(
            context,
            parse(moneybirdFxRateQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
