import { ImapFlow } from 'imapflow'
import type { InboundMessage, InboundPoll, InboundSource } from '@klopt/core'
import { messageFromRfc822 } from './mime.js'

/**
 * A mailbox, polled over IMAP (spec 6).
 *
 * The mailbox everybody already has: `facturen@` or `administratie@`, which
 * suppliers send to and which somebody currently opens and forwards by hand.
 *
 * ## The UID is the cursor, and it only moves on success
 *
 * IMAP gives every message in a mailbox a UID that rises monotonically and is
 * never reused, which is exactly what a cursor needs. `UID n:*` asks for
 * everything since last time — cheap, and it does not depend on flags, so a
 * human reading the mailbox in a mail client cannot make the poller skip
 * anything. (Searching `UNSEEN` instead would do just that, and it is the
 * commonest way this goes wrong.)
 *
 * The cursor is only stored on a poll that worked; the caller enforces that.
 * A failed poll that advanced it would skip everything that arrived while the
 * mailbox was unreachable, which is worse than not polling at all.
 *
 * ## Moving happens after the commit, and may be nothing at all
 *
 * `acknowledge` moves what was taken into a processed folder, so somebody
 * looking at the mailbox can see what the system has and what it has not. When
 * no folder is configured it marks the messages `\\Seen` instead, which is the
 * gentler thing to do to a mailbox a person also reads.
 *
 * Either way it runs after the documents are committed. A message moved before
 * the transaction commits is a message nobody will ever see again; a message
 * moved twice is nothing at all, because the UID went into the arrival's
 * external id.
 *
 * ## Nothing here throws
 *
 * A mailbox being down is not an error in the books. A poll that cannot connect
 * records the reason and returns, and the upload path is untouched — an inbox
 * one mailbox short is worse than yesterday; an inbox nobody can upload to is
 * broken.
 */

/** A safety limit per poll. A first run against a mailbox of 40 000 is not one transaction. */
const MAX_PER_POLL = 100

export interface ImapOptions {
  readonly host: string
  readonly port?: number | undefined
  readonly secure?: boolean | undefined
  readonly user: string
  readonly password: string
  /** Where invoices arrive. `INBOX` unless somebody files them. */
  readonly mailbox?: string | undefined
  /** Where they go once taken. Null marks them `\\Seen` and leaves them. */
  readonly processedMailbox?: string | null | undefined
  readonly name?: string | undefined
}

function parseCursor(cursor: string | null): number {
  const value = Number.parseInt(cursor ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function createImapSource(options: ImapOptions): InboundSource {
  const name = options.name ?? `imap:${options.user}`
  const mailbox = options.mailbox ?? 'INBOX'

  const connect = (): ImapFlow =>
    new ImapFlow({
      host: options.host,
      port: options.port ?? (options.secure === false ? 143 : 993),
      secure: options.secure ?? true,
      auth: { user: options.user, pass: options.password },
      // The library logs every command at info level otherwise, passwords
      // excepted but mailbox contents included.
      logger: false,
    })

  return {
    name,
    source: 'email',

    available() {
      if (options.host.trim() === '') return { ok: false, reason: 'No IMAP host is configured.' }
      if (options.user.trim() === '') return { ok: false, reason: 'No IMAP user is configured.' }
      if (options.password === '') {
        return { ok: false, reason: 'No password has been entered for this mailbox.' }
      }
      return { ok: true, reason: null }
    },

    async poll(cursor: string | null): Promise<InboundPoll> {
      const since = parseCursor(cursor)
      const client = connect()

      try {
        await client.connect()
        const lock = await client.getMailboxLock(mailbox)

        try {
          const messages: InboundMessage[] = []
          let highest = since

          // `n:*` is inclusive and always returns at least one message even when
          // nothing is new, so the one at the cursor itself is skipped below.
          const range = `${String(since + 1)}:*`

          for await (const message of client.fetch(
            range,
            { uid: true, source: true },
            { uid: true },
          )) {
            if (message.uid <= since) continue
            if (messages.length >= MAX_PER_POLL) break

            highest = Math.max(highest, message.uid)
            // A message whose source the server would not hand over is skipped
            // rather than guessed at, and the cursor still moves past it: a
            // poll that stopped dead on one unreadable message would take the
            // mailbox with it.
            if (message.source === undefined) continue

            const raw = new Uint8Array(message.source)
            messages.push(
              // The UID, not the Message-ID: two mailboxes can hold the same
              // message and a sender can reuse a Message-ID, but a UID is
              // unique within the mailbox this source is.
              await messageFromRfc822(raw, { externalId: `uid:${String(message.uid)}` }),
            )
          }

          return {
            source: name,
            ok: true,
            messages,
            failure: null,
            cursor: String(highest),
          }
        } finally {
          lock.release()
        }
      } catch (error: unknown) {
        return {
          source: name,
          ok: false,
          messages: [],
          failure: error instanceof Error ? error.message : String(error),
          cursor,
        }
      } finally {
        await client.logout().catch(() => undefined)
      }
    },

    async acknowledge(externalIds: readonly string[]): Promise<void> {
      const uids = externalIds
        .map((id) => Number.parseInt(id.replace(/^uid:/, ''), 10))
        .filter((uid) => Number.isFinite(uid) && uid > 0)

      if (uids.length === 0) return

      const client = connect()
      try {
        await client.connect()
        const lock = await client.getMailboxLock(mailbox)
        try {
          const range = uids.join(',')
          if (options.processedMailbox === null || options.processedMailbox === undefined) {
            await client.messageFlagsAdd(range, ['\\Seen'], { uid: true })
          } else {
            await client.mailboxCreate(options.processedMailbox).catch(() => undefined)
            await client.messageMove(range, options.processedMailbox, { uid: true })
          }
        } finally {
          lock.release()
        }
      } catch {
        // A failed acknowledgement means the message comes round again, and the
        // external id makes that harmless. It is not worth failing a poll whose
        // documents are already safely stored.
      } finally {
        await client.logout().catch(() => undefined)
      }
    },
  }
}
