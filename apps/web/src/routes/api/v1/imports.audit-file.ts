import { createFileRoute } from '@tanstack/react-router'
import { handleImportAuditFile } from '~/api/handlers/compliance'
import { auditFileImportBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Migration in (spec 13). Defaults to a dry run: the reconciliation report
 * against the file's own control totals comes before anything is committed.
 */
export const Route = createFileRoute('/api/v1/imports/audit-file')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleImportAuditFile(
            context,
            parse(auditFileImportBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
