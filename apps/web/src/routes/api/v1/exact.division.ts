import { createFileRoute } from '@tanstack/react-router'
import { handleChooseExactDivision } from '~/api/handlers/exact'
import { chooseExactDivisionBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Which Exact administration this entity imports from. */
export const Route = createFileRoute('/api/v1/exact/division')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleChooseExactDivision(
            context,
            parse(chooseExactDivisionBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
