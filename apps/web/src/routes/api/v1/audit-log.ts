import { createFileRoute } from '@tanstack/react-router'
import { handleListAuditLog } from '~/api/handlers/audit'
import { auditLogQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/** Who did what, when, from where. Newest first. */
export const Route = createFileRoute('/api/v1/audit-log')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleListAuditLog(
            context,
            parse(auditLogQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
