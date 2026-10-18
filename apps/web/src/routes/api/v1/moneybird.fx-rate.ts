import { createFileRoute } from '@tanstack/react-router'
import { handleMoneybirdFxRate, handleRefreshMoneybirdFxRate } from '~/api/handlers/moneybird'
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
      /** Fetch ECB into the cache, then return the rate — never done on GET. */
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleRefreshMoneybirdFxRate(
            context,
            parse(moneybirdFxRateQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
