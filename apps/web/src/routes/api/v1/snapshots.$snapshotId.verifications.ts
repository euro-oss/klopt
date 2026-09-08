import { createFileRoute } from '@tanstack/react-router'
import { handleVerifySnapshot } from '~/api/handlers/snapshots'
import { verifySnapshotQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * Checking a snapshot, and recording what was found.
 *
 * `POST` to a `verifications` collection rather than `GET`, because the outcome
 * is written down: a check that left no trace would make "we verified this in
 * March" unprovable, which is the same problem the snapshot exists to solve.
 */
export const Route = createFileRoute('/api/v1/snapshots/$snapshotId/verifications')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, (context) =>
          handleVerifySnapshot(
            context,
            params.snapshotId,
            parse(verifySnapshotQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
