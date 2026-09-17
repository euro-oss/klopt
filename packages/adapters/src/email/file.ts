import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EmailMessage, EmailResult, EmailTransport } from '@klopt/core'

/**
 * Write each message to a directory instead of sending it.
 *
 * Two real uses. A self-hoster bringing up an instance can point this at a
 * folder and read exactly what would have gone out, headers and attachments
 * included, without configuring a relay or risking mail to a real customer.
 * And the browser tests need to read a sign-in code from somewhere — the codes
 * are hashed in the database, deliberately, so the transport is the only
 * honest place to observe one.
 *
 * Not for production. It writes credentials to disk in plain text.
 */
export function createFileEmailTransport(directory: string): EmailTransport {
  let counter = 0

  return {
    name: 'file',

    send(message: EmailMessage): Promise<EmailResult> {
      counter += 1
      const id = `${Date.now().toString()}-${String(counter).padStart(3, '0')}`
      const path = join(directory, `${id}.txt`)

      // Created per message, not once at construction: the directory is one a
      // human empties while poking around, and a transport that then throws
      // ENOENT into an auth callback fails in a way nobody can trace.
      mkdirSync(directory, { recursive: true })

      writeFileSync(
        path,
        [
          `To: ${message.to}`,
          `Subject: ${message.subject}`,
          ...(message.replyTo === undefined ? [] : [`Reply-To: ${message.replyTo}`]),
          ...(message.reference === undefined ? [] : [`X-Klopt-Reference: ${message.reference}`]),
          ...(message.attachments ?? []).map(
            (attachment) =>
              `X-Klopt-Attachment: ${attachment.filename} (${attachment.contentType})`,
          ),
          '',
          message.text,
        ].join('\n'),
      )

      return Promise.resolve({ delivered: true, messageId: id, transport: 'file' })
    },
  }
}
