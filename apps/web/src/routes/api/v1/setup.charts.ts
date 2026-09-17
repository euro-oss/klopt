import { createFileRoute } from '@tanstack/react-router'
import { handleListCharts } from '~/api/handlers/setup'
import { handleUnscoped } from '~/api/runtime'

/**
 * The charts a new administration can be provisioned from (principle 6: they
 * are reference data, not code, so a self-hoster can add their own).
 */
export const Route = createFileRoute('/api/v1/setup/charts')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleUnscoped(request, (context) => Promise.resolve(handleListCharts(context))),
    },
  },
})
