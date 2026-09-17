import { createFileRoute } from '@tanstack/react-router'
import { handleIssueToken, handleListTokens } from '~/api/handlers/tokens'
import { issueTokenBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** The API tokens on these books. The secret is returned once, at issue. */
export const Route = createFileRoute('/api/v1/tokens')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListTokens(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleIssueToken(
            context,
            parse(issueTokenBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
