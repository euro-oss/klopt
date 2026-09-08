import { createFileRoute } from '@tanstack/react-router'
import { handleExportAuditLog } from '~/api/handlers/audit'
import { auditLogExportQuery } from '~/api/schemas'
import { parse, searchParams } from '~/api/runtime'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The audit log as a file (spec 7.6).
 *
 * Streamed, so the range somebody actually asks for — a whole year, or seven —
 * does not have to fit in memory first. That means the response cannot become a
 * problem document once it has started, which is why everything that can fail
 * (permission, parsing) fails before the first byte.
 */
export const Route = createFileRoute('/api/v1/audit-log/export')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const result = await handleExportAuditLog(
            context,
            parse(auditLogExportQuery, searchParams(request), 'The query string'),
          )

          return new Response(result.stream, {
            status: 200,
            headers: {
              'content-type': result.contentType,
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
