import type { EmailTransport } from '@klopt/core'
import { createLogEmailTransport } from './transport.js'
import { createFileEmailTransport } from './file.js'
import { createSmtpEmailTransport, smtpConfigFromEnvironment } from './smtp.js'

/**
 * Pick a transport from the environment.
 *
 * SMTP when configured; otherwise a directory if one is named; otherwise the
 * log. Section 8, rule 1: the implementation that needs no third party is the
 * default in a fresh install, and the instance stays usable without it — a
 * self-hoster with no relay can still read their sign-in code out of the
 * container log and get in.
 */
export function resolveEmailTransport(
  environment: Record<string, string | undefined> = process.env,
): EmailTransport {
  const config = smtpConfigFromEnvironment(environment)
  if (config !== null) return createSmtpEmailTransport(config)

  const outbox = environment['KLOPT_EMAIL_OUTBOX_DIR']
  if (outbox !== undefined && outbox !== '') return createFileEmailTransport(outbox)

  return createLogEmailTransport()
}
