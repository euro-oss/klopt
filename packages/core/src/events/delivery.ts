/**
 * When to try a webhook again, and when to stop (spec 10.2: "retries with
 * backoff").
 *
 * The shape follows the inbound-source backoff already in this codebase, for
 * the same reason it was written there: a subscriber that has been refusing
 * since Tuesday should not be contacted every fifteen seconds until somebody
 * notices. But it differs in the ending, and the difference is the point.
 *
 * A mailbox that cannot be polled loses nothing — the mail is still in it. A
 * webhook endpoint that cannot be reached is **holding up a queue**, because
 * delivery is ordered and the cursor does not advance past a failure. Falling
 * quietly further behind is the worst outcome available: the integrator
 * believes they are synchronised and they are a week stale.
 *
 * So there is a floor under how long this is allowed to go on. After enough
 * consecutive failures the endpoint is switched off and told why, which turns
 * a silent drift into something on a screen.
 */

/** Roughly a minute, then five, then twenty-five, up to the ceiling. */
const BASE_SECONDS = 60
const CEILING_SECONDS = 6 * 60 * 60

/**
 * How many attempts before the endpoint is switched off.
 *
 * Eight, which with the backoff below is a little over a day. Long enough to
 * ride out a deploy, a certificate renewal or a night of maintenance; short
 * enough that nobody discovers it a fortnight later.
 */
export const MAX_CONSECUTIVE_FAILURES = 8

/** Seconds to wait before attempt number `failures + 1`. */
export function backoffSeconds(failures: number): number {
  if (failures <= 0) return 0
  const seconds = BASE_SECONDS * Math.pow(5, Math.min(failures, 6) - 1)
  return Math.min(seconds, CEILING_SECONDS)
}

export interface DeliveryOutcome {
  /** Whether the receiver accepted it. Any 2xx does. */
  readonly delivered: boolean
  readonly status: number | null
  readonly error: string | null
}

export interface EndpointState {
  readonly consecutiveFailures: number
}

export type NextStep =
  | { readonly kind: 'advance' }
  | { readonly kind: 'retry'; readonly afterSeconds: number; readonly failures: number }
  | { readonly kind: 'disable'; readonly reason: string }

/**
 * What to do after an attempt.
 *
 * Pure, so the awkward cases — the ninth failure, a 410 — are decided in a
 * test rather than discovered in production at four in the morning.
 */
export function nextStep(state: EndpointState, outcome: DeliveryOutcome): NextStep {
  if (outcome.delivered) return { kind: 'advance' }

  const failures = state.consecutiveFailures + 1

  /**
   * 410 Gone means it. It is the one status whose entire meaning is "stop
   * asking", and honouring it is the difference between a well-behaved client
   * and one an integrator has to block at the firewall.
   */
  if (outcome.status === 410) {
    return { kind: 'disable', reason: 'The endpoint answered 410 Gone, which means stop sending.' }
  }

  /**
   * A 4xx other than 408 or 429 will not fix itself by being repeated: the
   * request is wrong, or the receiver has decided it is. Retrying it for a day
   * holds the queue up for nothing.
   */
  if (outcome.status !== null && outcome.status >= 400 && outcome.status < 500) {
    if (outcome.status !== 408 && outcome.status !== 429) {
      return {
        kind: 'disable',
        reason: `The endpoint answered ${String(outcome.status)}. A refusal in the 4xx range is not something retrying fixes.`,
      }
    }
  }

  if (failures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      kind: 'disable',
      reason: `${String(failures)} attempts in a row failed. Delivery is ordered, so the queue stops here rather than falling further behind: fix the endpoint and switch it back on.`,
    }
  }

  return { kind: 'retry', afterSeconds: backoffSeconds(failures), failures }
}
