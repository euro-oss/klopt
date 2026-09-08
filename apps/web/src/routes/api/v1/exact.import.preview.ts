import { createFileRoute } from '@tanstack/react-router'
import { handlePreviewExactImport } from '~/api/handlers/exact'
import { exactPreviewQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * The dry run (spec 13).
 *
 * "A dry-run mode producing a reconciliation report against the source
 * system's trial balance before anything is committed."
 */
export const Route = createFileRoute('/api/v1/exact/import/preview')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handlePreviewExactImport(
            context,
            parse(exactPreviewQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
