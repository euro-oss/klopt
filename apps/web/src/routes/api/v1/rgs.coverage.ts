import { createFileRoute } from '@tanstack/react-router'
import { handleGetRgsCoverage } from '~/api/handlers/compliance'
import { rgsCoverageQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * "Treat unmapped accounts as a first-class health metric on the dashboard,
 * not a settings screen nobody visits" (spec 7.1). This is that metric.
 */
export const Route = createFileRoute('/api/v1/rgs/coverage')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleGetRgsCoverage(
            context,
            parse(rgsCoverageQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
