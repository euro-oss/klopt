import { createFileRoute } from '@tanstack/react-router'
import { handleGetSnapshotTimestamp } from '~/api/handlers/snapshots'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The timestamp authority's reply, as it arrived (spec 7.6, ADR 0058).
 *
 * The bytes rather than a description of them: verifying a token means running
 * `openssl ts -verify` against the file with the authority's own certificate
 * chain, and that is a thing somebody does outside this instance. Handing over
 * the file is what "publishing a seal" amounts to.
 */
export const Route = createFileRoute('/api/v1/snapshots/$snapshotId/timestamp')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const result = await handleGetSnapshotTimestamp(context, params.snapshotId)

          return new Response(result.token, {
            status: 200,
            headers: {
              'content-type': 'application/timestamp-reply',
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
