import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The root route declares an `errorComponent`.
 *
 * Every screen loads through a server function, and a loader that fails — a
 * dropped connection, a request cancelled by navigating away, a server that
 * restarted — rendered *nothing* without one. React said so on every run:
 * "the following error wasn't caught by any route. At the very least, consider
 * setting an 'errorComponent' in your RootRoute!" It appeared in the Playwright
 * output of three separate suites before anybody read it.
 *
 * A blank frame is the one failure mode nobody can report usefully, which is
 * what makes this worth a test rather than a comment.
 *
 * This asserts the wiring rather than the behaviour, and that is a deliberate
 * limit. Synthesising a client-side loader failure in a browser turned out to
 * be unreliable — the router preloads, so the data is already there by the time
 * a request could be blocked — and a test that passes because it failed to
 * provoke the thing it is testing is worse than one that admits its scope. The
 * real evidence the component is reached is that React's warning stopped
 * appearing.
 */

const ROOT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'routes', '__root.tsx'),
  'utf8',
)

describe('the root route', () => {
  it('handles a failed load rather than rendering nothing', () => {
    expect(ROOT).toContain('errorComponent:')
  })

  it('shows the message and offers a retry', () => {
    // Both matter. The message is what a bookkeeper can pass on, and the retry
    // is what fixes the commonest cause without a full reload.
    expect(ROOT).toContain('error.message')
    expect(ROOT).toContain('Opnieuw proberen')
  })
})
