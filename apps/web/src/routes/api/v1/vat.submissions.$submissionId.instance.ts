import { createFileRoute } from '@tanstack/react-router'
import { handleGetFiledInstance } from '~/api/handlers/vat'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The XBRL instance as filed, served from what was stored rather than
 * regenerated. Keeping the bytes is the point: regenerating them later may give
 * something different, and if it does, a suppletie is owed.
 *
 * Returns XML so `curl -O` does the obvious thing. `?format=summary` gives the
 * human-readable rendering instead — that is what somebody filing by hand in
 * Mijn Belastingdienst Zakelijk actually reads.
 */
export const Route = createFileRoute('/api/v1/vat/submissions/$submissionId/instance')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const found = await handleGetFiledInstance(context, params.submissionId)
          const wantsSummary = new URL(request.url).searchParams.get('format') === 'summary'

          if (wantsSummary) {
            if (found.summary === null) {
              return problemResponse(new Error('This submission has no summary stored.'), requestId)
            }
            return new Response(found.summary, {
              status: 200,
              headers: {
                'content-type': 'text/plain; charset=utf-8',
                'content-disposition': `attachment; filename="aangifte-${params.submissionId}.txt"`,
                'x-request-id': context.requestId,
              },
            })
          }

          return new Response(found.xml, {
            status: 200,
            headers: {
              'content-type': 'application/xml; charset=utf-8',
              'content-disposition': `attachment; filename="aangifte-${params.submissionId}.xbrl"`,
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
