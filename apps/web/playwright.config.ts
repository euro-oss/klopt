import { defineConfig, devices } from '@playwright/test'
import { e2eWebServerEnv, OUTBOX } from './e2e/server-env'

/**
 * Browser tests (spec 11.4).
 *
 * These exist because of a specific bug: the root layout returned the
 * signed-out placeholder *instead of* rendering its children, so every route
 * looked identical while signed out — including the sign-in page. Clicking
 * "Aanmelden" changed the URL and nothing else. Server-side render assertions
 * missed it entirely, because the HTML for `/sign-in` was valid HTML for a
 * different page.
 *
 * So the rule for what belongs here: **anything where the failure is "the
 * screen did not change"**. Navigation, redirects, focus, the entry form's
 * keyboard flow. Business rules are tested against the domain, not a browser.
 */
/** Shared with e2e/auth.spec.ts, which reads the delivered codes from here. */
export { OUTBOX }

/**
 * Documents go in a directory for the browser suite, whatever the developer's
 * shell has configured.
 *
 * Without this, a developer with `KLOPT_S3_ENDPOINT` set runs every browser
 * test's uploads over the network to MinIO — slower, and a source of timing
 * flakes in tests that are about screens rather than storage. The S3 store has
 * its own tests (`packages/adapters/test/documents/s3.test.ts` and
 * `apps/web/test/retention-worm.test.ts`) which exercise it directly, against a
 * bucket in their own process and against a real one on demand (ADR 0059).
 *
 * So no browser spec needs object storage, which is why none of them had to be
 * skipped or given a fake of their own when CI stopped depending on MinIO.
 *
 * SMTP is the same shape of leak (issue #120): `resolveEmailTransport` prefers
 * a configured relay, so an exported `KLOPT_SMTP_HOST` would mail fixture
 * addresses for real. `e2eWebServerEnv` blanks every SMTP key the resolver
 * reads; the unit gate in `test/e2e-smtp-env.test.ts` fails if that ever stops
 * forcing the file outbox.
 *
 * `reuseExistingServer` and `KLOPT_E2E_BASE_URL` bypass that blanking — they
 * talk to a server the suite did not start. Mail-sending specs must therefore
 * assert the file outbox received the message (see `codeFor` /
 * `waitForOutboxTo`); an SMTP-configured reused server leaves the outbox empty
 * and the assertion fails rather than silently sending.
 */

const pointingAtExternalServer = process.env['KLOPT_E2E_BASE_URL'] !== undefined

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: process.env['CI'] === 'true',
  retries: process.env['CI'] === 'true' ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] === 'true' ? 'line' : 'list',

  use: {
    baseURL: process.env['KLOPT_E2E_BASE_URL'] ?? 'http://localhost:3399',
    trace: 'retain-on-failure',

    // These specs assert Dutch copy, so say so rather than inheriting whatever
    // language the browser on this machine happens to ask for. Chromium
    // defaults to en-US, which the app now honours — correctly, and it would
    // otherwise make the whole suite depend on where it runs. The specs about
    // language negotiation open their own contexts and override this.
    locale: 'nl-NL',
  },

  testIgnore: [
    '**/fiscal-year-booking-200.spec.ts',
    '**/pr-screenshots-200.spec.ts',
    // Needs the fake server clock; runs via playwright.contacts-midnight.config.ts.
    '**/*-midnight.spec.ts',
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Reuses a server if one is already listening, so a developer with `pnpm
  // dev` (or a prior e2e) on 3399 does not get a second one. That reused
  // process keeps *its* environment — including any SMTP the developer
  // exported — so mail-sending specs must check the file outbox (above).
  // Point KLOPT_E2E_BASE_URL at an instance to skip starting one at all; same
  // outbox-guard rule applies.
  ...(pointingAtExternalServer
    ? {}
    : {
        webServer: {
          command: 'vite dev --port 3399',
          stdout: 'pipe',
          stderr: 'pipe',
          port: 3399,
          // Never reuse: a prior calendar-proof run leaves KLOPT_E2E_TODAY_ISO on the dev server.
          reuseExistingServer: false,
          timeout: 120_000,
          env: e2eWebServerEnv(),
        },
      }),
})
