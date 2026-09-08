import { createFileRoute } from '@tanstack/react-router'
import { handleGetSnapshotManifest } from '~/api/handlers/snapshots'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The manifest text.
 *
 * Plain text rather than JSON, because this *is* the artefact: it is what the
 * seal is computed over, and a reader with `sha256sum` should be able to check
 * one against the other without a parser in between.
 */
export const Route = createFileRoute('/api/v1/snapshots/$snapshotId/manifest')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const result = await handleGetSnapshotManifest(context, params.snapshotId)

          return new Response(result.manifest, {
            status: 200,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
              'content-disposition': `attachment; filename="${result.filename}"`,
              'x-request-id': context.requestId,
            },
          })
        } catch (error: unknown) {
          return problemResponse(error, requestId)
        }
      },
    },
  },
})
