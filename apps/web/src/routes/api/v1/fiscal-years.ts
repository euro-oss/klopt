import { createFileRoute } from '@tanstack/react-router'
import { handleCreateFiscalYear, handleListFiscalYears } from '~/api/handlers/setup'
import { createFiscalYearBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Book years. A close posts its opening balance into the next one, so opening
 * a year is a prerequisite for closing the one before it — not an afterthought.
 */
export const Route = createFileRoute('/api/v1/fiscal-years')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListFiscalYears(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCreateFiscalYear(
            context,
            parse(createFiscalYearBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
