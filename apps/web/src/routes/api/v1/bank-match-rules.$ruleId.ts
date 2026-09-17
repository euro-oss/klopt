import { createFileRoute } from '@tanstack/react-router'
import { handleSetMatchRuleActive } from '~/api/handlers/bank'
import { setRuleActiveBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Switch a rule off, or back on. The editable half of "visible and editable". */
export const Route = createFileRoute('/api/v1/bank-match-rules/$ruleId')({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handle(request, async (context) =>
          handleSetMatchRuleActive(
            context,
            params.ruleId,
            parse(setRuleActiveBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
