import { createFileRoute } from '@tanstack/react-router'
import { handleListSnapshots, handleSealSnapshot } from '~/api/handlers/snapshots'
import { sealSnapshotBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Sealed snapshots: the "prove nothing changed" artefact (spec 7.6).
 *
 * Reading is `ledger:read` and sealing is `ledger:export`, which is deliberate:
 * a seal nobody can see is a seal nobody checks.
 */
export const Route = createFileRoute('/api/v1/snapshots')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListSnapshots(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleSealSnapshot(
            context,
            parse(sealSnapshotBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
