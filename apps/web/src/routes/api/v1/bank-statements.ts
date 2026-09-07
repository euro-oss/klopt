import { createFileRoute } from '@tanstack/react-router'
import { handleImportStatement } from '~/api/handlers/bank'
import { importStatementBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Import a CAMT.053 or MT940 file. `dryRun` reports what would happen and
 * writes nothing, which is worth having when a bank download is often the
 * wrong month.
 */
export const Route = createFileRoute('/api/v1/bank-statements')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleImportStatement(
            context,
            parse(importStatementBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
