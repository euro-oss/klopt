import { createFileRoute } from '@tanstack/react-router'
import { handleRunExactImport } from '~/api/handlers/exact'
import { runExactImportBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * The import itself (spec 13).
 *
 * Everything the dry run described, in one transaction: the chart of accounts,
 * the relations, and the open items with a single opening entry behind them.
 */
export const Route = createFileRoute('/api/v1/exact/import')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleRunExactImport(
            context,
            parse(runExactImportBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
