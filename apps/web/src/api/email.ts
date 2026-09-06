import { resolveEmailTransport, type EmailTransport } from '@klopt/adapters'

/**
 * One email transport per process.
 *
 * SMTP when it is configured, otherwise the message goes to the log — so a
 * fresh install with no mail server still lets you invite somebody, and the
 * operator can read what would have been sent.
 */

let transport: EmailTransport | null = null

export function getEmailTransport(): EmailTransport {
  transport ??= resolveEmailTransport()
  return transport
}

/** Test seam. */
export function setEmailTransportForTest(value: EmailTransport | null): void {
  transport = value
}
