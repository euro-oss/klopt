import { nextStep, signWebhook, assertSafeHttpsUrl, type DeliveryOutcome } from '@klopt/core'
import type { Database } from '../client.js'
import { decryptSecret } from '../secrets.js'
import { withWebhooks } from '../unit-of-work.js'
import type { EndpointRow } from '../repositories/webhooks.js'

/**
 * Delivering the event stream to subscribers (spec 10.2).
 *
 * Here rather than in `apps/worker` for the same reason the Exact import is:
 * it needs both the repositories and the domain policy, and `packages/adapters`
 * may not import `@klopt/db`. The worker calls this and owns the schedule;
 * everything about *what* to send lives here.
 *
 * ## Ordered, and it stops rather than skipping
 *
 * One endpoint, one cursor, one event at a time. The cursor moves only after a
 * 2xx, so an endpoint that refuses event 40 never sees 41 until 40 lands. That
 * is the guarantee an integration needs and it is also the risk: a poisonous
 * event stops the queue. `nextStep` decides how long that is tolerated before
 * the endpoint is switched off and told why.
 *
 * ## Never throws
 *
 * A subscriber being down is not this job failing. The outcome is recorded per
 * endpoint and the job returns normally, exactly as the inbound poller does —
 * otherwise one broken URL turns into a failed job and a retry storm.
 *
 * ## No private targets, no redirects
 *
 * The host is resolved and refused when it is private, link-local or loopback,
 * both at registration and here (audit M1). `redirect: 'manual'` means a 302
 * onto `http://169.254.169.254/` is a failed delivery rather than a followed
 * hop — we do not chase Location headers.
 */

/** Injected so a test cannot reach the network. See `importExactDocuments`. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** How long to wait on a subscriber before giving up on the attempt. */
const TIMEOUT_MS = 10_000

export interface DeliveryReport {
  readonly endpoints: number
  readonly delivered: number
  readonly failed: number
  readonly disabled: number
}

export async function deliverWebhooks(
  database: Database,
  options: {
    readonly fetch?: FetchLike
    readonly now?: Date
    readonly batchSize?: number
    /** Override the outbound URL check. Tests inject a no-op so they need no DNS. */
    readonly assertUrl?: (url: string) => Promise<void>
  } = {},
): Promise<DeliveryReport> {
  const doFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const assertUrl = options.assertUrl ?? assertSafeHttpsUrl
  const now = options.now ?? new Date()

  const due = await withWebhooks(database, (repository) => repository.due(now))

  let delivered = 0
  let failed = 0
  let disabled = 0

  for (const endpoint of due) {
    const secret = decryptSecret(endpoint.secret)
    if (secret === null) {
      // The key changed, or was never set. Saying so beats sending unsigned
      // deliveries or failing silently forever.
      await withWebhooks(database, (repository) =>
        repository.disable(
          endpoint.id,
          'The signing secret could not be decrypted. KLOPT_ENCRYPTION_KEY has changed since this endpoint was created; delete it and add it again.',
        ),
      )
      disabled += 1
      continue
    }

    const pending = await withWebhooks(database, (repository) =>
      repository.pending(endpoint, options.batchSize ?? 20),
    )

    for (const event of pending) {
      const outcome = await attempt(doFetch, assertUrl, endpoint, secret, event)
      const step = nextStep({ consecutiveFailures: endpoint.consecutiveFailures }, outcome)

      await withWebhooks(database, async (repository) => {
        await repository.recordAttempt({
          entityId: endpoint.entityId,
          endpointId: endpoint.id,
          eventId: event.id,
          attempt: endpoint.consecutiveFailures + 1,
          responseStatus: outcome.status,
          error: outcome.error,
          durationMs: outcome.durationMs,
        })

        if (step.kind === 'advance') await repository.advance(endpoint.id, event.id)
        else if (step.kind === 'retry') {
          await repository.scheduleRetry(endpoint.id, step.failures, step.afterSeconds)
        } else await repository.disable(endpoint.id, step.reason)
      })

      if (step.kind === 'advance') {
        delivered += 1
        continue
      }

      // Ordered delivery: stop at the first failure rather than skipping past
      // it, and come back to the same event next time.
      if (step.kind === 'retry') failed += 1
      else disabled += 1
      break
    }
  }

  return { endpoints: due.length, delivered, failed, disabled }
}

/** One HTTP attempt, with the signature and the timeout. */
async function attempt(
  doFetch: FetchLike,
  assertUrl: (url: string) => Promise<void>,
  endpoint: EndpointRow,
  secret: string,
  event: { id: string; occurredAt: string; type: string; version: number; payload: unknown },
): Promise<DeliveryOutcome & { durationMs: number }> {
  const reference = event.payload as { resourceType?: string; resourceId?: string } | null

  const body = JSON.stringify({
    id: event.id,
    occurredAt: event.occurredAt,
    type: event.type,
    version: event.version,
    entityId: endpoint.entityId,
    resource: {
      type: reference?.resourceType ?? null,
      id: reference?.resourceId ?? null,
    },
  })

  const timestamp = Math.floor(Date.now() / 1000)
  const started = Date.now()

  try {
    // Re-check at delivery: DNS can change between registration and now.
    await assertUrl(endpoint.url)

    const response = await doFetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'klopt-signature': signWebhook(secret, body, timestamp),
        // So a receiver can dedup without parsing, and log without guessing.
        'klopt-event-id': event.id,
        'klopt-event-type': event.type,
        'user-agent': 'Klopt-Webhooks/1',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    return {
      // Any 2xx. A receiver that answers 204 has accepted it as much as one
      // that answers 200, and insisting on a particular success code is how a
      // client becomes annoying to write against. 3xx is a failure: we do not
      // follow redirects (audit M1).
      delivered: response.status >= 200 && response.status < 300,
      status: response.status,
      error:
        response.status >= 300 && response.status < 400
          ? `Subscriber answered ${String(response.status)}; redirects are not followed.`
          : null,
      durationMs: Date.now() - started,
    }
  } catch (cause: unknown) {
    return {
      delivered: false,
      status: null,
      error: cause instanceof Error ? cause.message : String(cause),
      durationMs: Date.now() - started,
    }
  }
}
