import { createFileRoute } from '@tanstack/react-router'
import { handleGetDocument } from '~/api/handlers/inbox'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * A source document, as stored.
 *
 * The bytes come back with their own content type, so a browser shows a PDF and
 * downloads a UBL. Content-addressed storage means what comes out is byte for
 * byte what went in — the address is the hash of the answer.
 */
export const Route = createFileRoute('/api/v1/documents/$documentId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const found = await handleGetDocument(context, params.documentId)
          return new Response(found.bytes as BodyInit, {
            status: 200,
            headers: {
              'content-type': found.contentType,
              'content-disposition': `inline; filename="${found.filename}"`,
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
