/**
 * Sending email.
 *
 * The first adapter family to get a real port, and it earns it by having three
 * separate callers: the sign-in code, invoice delivery and dunning (M1), and
 * the e-invoice email fallback — "email the UBL plus a PDF rendering ... not
 * Peppol, but it is what most Dutch SMBs actually exchange today" (spec 7.5).
 *
 * Rule 1 of section 8 applies: **the default implementation requires no third
 * party.** A fresh install with no SMTP configured writes the message to the
 * log and keeps working, so `pnpm dev` needs no mail server and a self-hoster
 * is never locked out of their own instance by a misconfigured relay.
 */

import type { EmailMessage, EmailTransport } from '@klopt/core'

export type { EmailAttachment, EmailMessage, EmailResult, EmailTransport } from '@klopt/core'

/**
 * The no-configuration default. Writes to the log instead of sending.
 *
 * Deliberately loud about it: an operator who has not set SMTP up should be
 * able to find the sign-in code in their container logs and get in, and should
 * also be in no doubt that nothing was actually delivered.
 */
export function createLogEmailTransport(
  write: (line: string) => void = (line) => {
    console.info(line)
  },
): EmailTransport {
  return {
    name: 'log',
    send(message) {
      write(
        [
          '',
          '┌─ email not sent: no SMTP configured ─────────────────────────',
          `│ to:      ${message.to}`,
          `│ subject: ${message.subject}`,
          ...message.text.split('\n').map((line) => `│ ${line}`),
          ...(message.attachments ?? []).map(
            (attachment) => `│ [attachment] ${attachment.filename} (${attachment.contentType})`,
          ),
          '└──────────────────────────────────────────────────────────────',
          '',
        ].join('\n'),
      )
      return Promise.resolve({ delivered: false, messageId: null, transport: 'log' })
    },
  }
}

/** Collects messages instead of sending them. For tests. */
export function createMemoryEmailTransport(): EmailTransport & {
  readonly sent: EmailMessage[]
} {
  const sent: EmailMessage[] = []
  return {
    name: 'memory',
    sent,
    send(message) {
      sent.push(message)
      return Promise.resolve({
        delivered: true,
        messageId: `memory-${String(sent.length)}`,
        transport: 'memory',
      })
    },
  }
}
