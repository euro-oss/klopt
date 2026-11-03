import { join } from 'node:path'

/**
 * Environment for the Playwright-started e2e web server.
 *
 * Keys named here *replace* the inherited process environment for those keys
 * (Playwright's `webServer.env` behaviour). Blanking SMTP — rather than leaving
 * the keys absent — is what stops a developer's exported `KLOPT_SMTP_*` from
 * reaching the resolver and mailing a fixture address for real (issue #120).
 *
 * Shared with the unit gate in `test/e2e-smtp-env.test.ts` so the blanking the
 * suite relies on cannot drift from the assertion that proves it.
 */

/** Messages land here; specs read codes and invoice mail from the files. */
export const OUTBOX = join(import.meta.dirname, '.outbox')

/** Uploads stay on disk for the browser suite, whatever the shell has for S3. */
export const DOCUMENTS = join(import.meta.dirname, '.documents')

/**
 * SMTP variables `smtpConfigFromEnvironment` / `resolveEmailTransport` read.
 * Every one is forced empty so a partial shell export cannot assemble a relay.
 */
export const E2E_SMTP_BLANK = {
  KLOPT_SMTP_HOST: '',
  KLOPT_SMTP_FROM: '',
  KLOPT_SMTP_PORT: '',
  KLOPT_SMTP_USER: '',
  KLOPT_SMTP_PASSWORD: '',
  KLOPT_SMTP_SECURE: '',
  KLOPT_SMTP_INSECURE_TLS: '',
} as const

export function e2eWebServerEnv(
  environment: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return {
    DATABASE_URL:
      environment['TEST_DATABASE_URL'] ??
      environment['DATABASE_URL'] ??
      'postgres://klopt:klopt@localhost:5432/klopt',
    KLOPT_AUTH_SECRET: 'e2e-secret-not-for-production-0123456789',
    // Forty sign-ins in three minutes from one address is what this suite is;
    // the limiter has its own test.
    KLOPT_RATE_LIMIT: 'off',
    KLOPT_BASE_URL: 'http://localhost:3399',
    // Absolute: a relative path here silently depends on the server's working
    // directory, which is not the one the test resolves from.
    KLOPT_EMAIL_OUTBOX_DIR: OUTBOX,
    KLOPT_DOCUMENT_DIR: DOCUMENTS,
    // Explicitly empty rather than absent: `env` here *replaces* the inherited
    // environment for the keys it names, and leaving these out would let a
    // developer's own S3 / SMTP settings through.
    KLOPT_S3_ENDPOINT: '',
    ...E2E_SMTP_BLANK,
    // An Exact Online client secret is encrypted at rest, so the screen
    // refuses to take one without a key. An instance that has Exact
    // configured has a key, so the browser test runs with one.
    KLOPT_ENCRYPTION_KEY: 'e2e-encryption-key-not-for-production-01234',
    // Legal URLs stay unset (self-hosted). Specs that need the hosted
    // checkbox set cookie `klopt-e2e-legal=on` (see legal-links.ts).
    KLOPT_E2E_LEGAL_TOGGLE: '1',
  }
}
