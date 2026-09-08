import { withAudit } from '@klopt/db'
import type { RequestContext } from './context.js'

/**
 * Recording that somebody did something (spec 7.6).
 *
 * One line at the end of a handler, carrying the request's own identity — the
 * actor, the request id and the IP are already resolved and nobody should be
 * retyping them. What the handler supplies is the part only it knows: what
 * changed, to what, and from what.
 *
 * ## Why this is a separate call rather than something the glue does
 *
 * A wrapper around every route could record *that* a call happened, and would
 * know nothing about what it did. `before` and `after` are the useful columns —
 * "the VAT rounding went from per_invoice to per_line" is an audit entry; "a
 * PATCH to /entity returned 200" is a web-server log. Only the handler holds
 * both sides, so the call lives where the knowledge is.
 *
 * The cost is that a new handler can forget. That is a real hole, and the
 * answer to it is `test/audit.test.ts`, which drives every consequential action
 * and asserts a row comes out.
 *
 * ## Failures are swallowed, and that is the lesser evil
 *
 * The change has already committed by the time this runs. Throwing here would
 * turn "the payment was approved and we failed to write it down" into "the
 * payment was approved and the caller was told it failed", which invites a
 * retry of something that already happened. So the row is best-effort and loud
 * in the log.
 *
 * The exception is the journal, whose audit row is written *inside* the posting
 * transaction (`LedgerRepository.appendAudit`). An entry in the hash chain with
 * no audit row is precisely what an inspector looks for, so that one is atomic
 * and always has been.
 */
export async function recordAudit(
  context: RequestContext,
  event: {
    readonly action: string
    readonly resourceType: string
    readonly resourceId: string
    readonly before?: unknown
    readonly after?: unknown
  },
): Promise<void> {
  try {
    await withAudit(context.database, (repository) =>
      repository.append({
        entityId: context.entityId,
        actor: context.actor,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        before: event.before ?? null,
        after: event.after ?? null,
        requestId: context.requestId,
        ip: context.ip,
      }),
    )
  } catch (error: unknown) {
    console.error('[audit] could not record', event.action, event.resourceId, error)
  }
}
