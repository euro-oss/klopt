import { createFileRoute } from '@tanstack/react-router'
import { contentDispositionHeader } from '@klopt/core'
import { handleGetDocument } from '~/api/handlers/inbox'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * A source document, as stored.
 *
 * Only PDF, PNG and JPEG are served `inline` — everything else is an
 * attachment with `nosniff`, so an HTML or SVG upload cannot run on this
 * origin as the signed-in bookkeeper (audit H1, L2). Content-addressed
 * storage means what comes out is byte for byte what went in.
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
          const { header: contentDisposition } = contentDispositionHeader(
            found.contentType,
            found.filename,
          )
          return new Response(found.bytes as BodyInit, {
            status: 200,
            headers: {
              'content-type': found.contentType,
              'content-disposition': contentDisposition,
              'x-content-type-options': 'nosniff',
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
