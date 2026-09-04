import { createFileRoute } from '@tanstack/react-router'
import { handleExportAuditFile } from '~/api/handlers/compliance'
import { auditFileQuery } from '~/api/schemas'
import { getDatabase, parse, searchParams } from '~/api/runtime'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The anti-lock-in guarantee: a valid XAF 3.2 with RGS codes, always available
 * (principle 2). Returns XML rather than JSON, so `curl -O` does the obvious
 * thing and an accountant can be handed a scoped token instead of a login.
 */
export const Route = createFileRoute('/api/v1/exports/audit-file')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const result = await handleExportAuditFile(
            context,
            parse(auditFileQuery, searchParams(request), 'The query string'),
          )

          return new Response(result.xml, {
            status: 200,
            headers: {
              'content-type': 'application/xml; charset=utf-8',
              'content-disposition': `attachment; filename="${result.filename}"`,
              'x-klopt-line-count': String(result.lineCount),
              'x-klopt-warnings': String(result.warnings.length),
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
