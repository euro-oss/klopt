import { describe, expect, it } from 'vitest'
import { MAX_CONSECUTIVE_FAILURES, backoffSeconds, nextStep } from '../../src/events/delivery.js'

/**
 * When to try a webhook again, and when to stop (spec 10.2).
 *
 * Delivery is ordered, so a failure holds up everything behind it. The
 * question this answers is not "how do we keep trying" but "how long is it
 * acceptable to be quietly falling behind".
 */

const ok = { delivered: true, status: 200, error: null }
const refused = (status: number) => ({ delivered: false, status, error: null })
const unreachable = { delivered: false, status: null, error: 'ECONNREFUSED' }

describe('after a delivery', () => {
  it('moves the cursor on when it was accepted', () => {
    expect(nextStep({ consecutiveFailures: 3 }, ok)).toEqual({ kind: 'advance' })
  })

  it('backs off further each time', () => {
    const waits = [1, 2, 3, 4].map((failures) => backoffSeconds(failures))
    expect(waits).toEqual([60, 300, 1500, 7500])
    // And stops growing, rather than scheduling the next attempt for Tuesday.
    expect(backoffSeconds(99)).toBe(6 * 60 * 60)
  })

  it('retries something that might recover', () => {
    expect(nextStep({ consecutiveFailures: 0 }, unreachable)).toEqual({
      kind: 'retry',
      afterSeconds: 60,
      failures: 1,
    })
    expect(nextStep({ consecutiveFailures: 1 }, refused(500))).toMatchObject({ kind: 'retry' })
    expect(nextStep({ consecutiveFailures: 1 }, refused(429))).toMatchObject({ kind: 'retry' })
    expect(nextStep({ consecutiveFailures: 1 }, refused(408))).toMatchObject({ kind: 'retry' })
  })

  it('stops when the endpoint says stop', () => {
    // 410 Gone is the one status whose entire meaning is "do not come back".
    const step = nextStep({ consecutiveFailures: 0 }, refused(410))
    expect(step.kind).toBe('disable')
    expect(step.kind === 'disable' && step.reason).toContain('410')
  })

  it('stops on a refusal that repeating cannot fix', () => {
    // A 404 or a 401 is wrong now and will be wrong in six hours. Retrying it
    // for a day holds up the queue for nothing.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(nextStep({ consecutiveFailures: 0 }, refused(status)).kind).toBe('disable')
    }
  })

  it('gives up after a day of trying, loudly', () => {
    const step = nextStep({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 }, unreachable)

    expect(step.kind).toBe('disable')
    // The reason has to tell an operator what to do, because the queue is
    // stopped until they do it.
    expect(step.kind === 'disable' && step.reason).toContain('switch it back on')
  })

  it('does not give up one attempt early', () => {
    expect(nextStep({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 2 }, unreachable).kind).toBe(
      'retry',
    )
  })
})
