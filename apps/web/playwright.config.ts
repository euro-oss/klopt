import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

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
export const OUTBOX = join(import.meta.dirname, 'e2e', '.outbox')

/**
 * Documents go in a directory for the browser suite, whatever the developer's
 * shell has configured.
 *
 * Without this, a developer with `KLOPT_S3_ENDPOINT` set runs every browser
 * test's uploads over the network to MinIO — slower, and a source of timing
 * flakes in tests that are about screens rather than storage. The S3 store has
 * its own tests (`packages/adapters/test/documents/s3.test.ts` and
 * `apps/web/test/retention-worm.test.ts`) which exercise it directly and
 * against a real bucket.
 */
const DOCUMENTS = join(import.meta.dirname, 'e2e', '.documents')

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

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Reuses a server if one is already listening, so a developer with `pnpm dev`
  // running does not get a second one on the same port. Point
  // KLOPT_E2E_BASE_URL at an instance to skip starting one at all.
  ...(process.env['KLOPT_E2E_BASE_URL'] === undefined
    ? {
        webServer: {
          command: 'vite dev --port 3399',
          stdout: 'pipe',
          stderr: 'pipe',
          port: 3399,
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            DATABASE_URL:
              process.env['TEST_DATABASE_URL'] ??
              process.env['DATABASE_URL'] ??
              'postgres://klopt:klopt@localhost:5432/klopt',
            KLOPT_AUTH_SECRET: 'e2e-secret-not-for-production-0123456789',
            // Forty sign-ins in three minutes from one address is what this
            // suite is; the limiter has its own test.
            KLOPT_RATE_LIMIT: 'off',
            KLOPT_BASE_URL: 'http://localhost:3399',
            // No SMTP. Messages are written to a directory the tests read,
            // because the codes are hashed in the database on purpose.
            // Absolute: a relative path here silently depends on the server's
            // working directory, which is not the one the test resolves from.
            KLOPT_EMAIL_OUTBOX_DIR: OUTBOX,
            KLOPT_DOCUMENT_DIR: DOCUMENTS,
            // Explicitly empty rather than absent: `env` here *replaces* the
            // inherited environment for the keys it names, and leaving this out
            // would let a developer's own S3 settings through.
            KLOPT_S3_ENDPOINT: '',
            // An Exact Online client secret is encrypted at rest, so the screen
            // refuses to take one without a key. An instance that has Exact
            // configured has a key, so the browser test runs with one.
            KLOPT_ENCRYPTION_KEY: 'e2e-encryption-key-not-for-production-01234',
          },
        },
      }
    : {}),
})
