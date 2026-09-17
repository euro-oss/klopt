import { createFileRoute } from '@tanstack/react-router'
import { handlePreviewRgsUpgrade } from '~/api/handlers/compliance'
import { rgsUpgradeQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * "RGS version upgrades are a migration with a diff report, never a silent
 * remap" (spec 7.1). This is the diff report.
 */
export const Route = createFileRoute('/api/v1/rgs/upgrade-preview')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handlePreviewRgsUpgrade(
            context,
            parse(rgsUpgradeQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
