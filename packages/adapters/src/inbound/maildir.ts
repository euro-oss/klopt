import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  contentTypeFor,
  type InboundMessage,
  type InboundPoll,
  type InboundSource,
} from '@klopt/core'
import { messageFromDocument, messageFromRfc822 } from './mime.js'

/**
 * A directory documents are dropped into — the default that needs no third
 * party (spec 8, rule 1).
 *
 * This is not a toy standing in for a real transport. It is exactly what a mail
 * server's own delivery hook, a `procmail` recipe, a `fetchmail` run or a
 * scanner writing to a share already produces, and it means a self-hosted
 * instance can receive invoices by email **without this process ever holding an
 * IMAP password**. The credential stays with the thing that was already going
 * to have it.
 *
 * ## Two kinds of file, one queue
 *
 * An `.eml` is a whole message and is read as one. Anything else — a UBL a
 * supplier sent over Peppol and somebody saved, a PDF off a scanner — is one
 * document, wrapped as a message carrying a single attachment so that the
 * attachment rules and the deduplication work on one shape.
 *
 * ## Moving is the cursor
 *
 * There is no cursor. `acknowledge` moves what was taken into a `.verwerkt`
 * subdirectory, which is both the record and the reason the next poll does not
 * see it again. Moving rather than deleting matters: the operator can look at
 * what was taken, and a mistake is recoverable with `mv`.
 *
 * The move happens **after** the documents are committed, so a crash in between
 * leaves the file in place and the next poll takes it again. The arrival's
 * external id — here, the filename — makes that duplicate harmless. At-least-
 * once is the correct failure direction, because the other one loses invoices.
 */

/** Where taken files go. Dot-prefixed so a poll never sees its own output. */
const PROCESSED = '.verwerkt'

/** A safety limit per poll: a directory with 10 000 files should not be one transaction. */
const MAX_PER_POLL = 200

export interface MaildirOptions {
  readonly directory: string
  readonly name?: string | undefined
  /** Which arrivals these are. A directory fed by Peppol says so. */
  readonly source?: 'email' | 'peppol' | undefined
}

export function createMaildirSource(options: MaildirOptions): InboundSource {
  const name = options.name ?? `maildir:${basename(options.directory)}`
  const source = options.source ?? 'email'
  const processedDirectory = join(options.directory, PROCESSED)

  return {
    name,
    source,

    available() {
      if (options.directory.trim() === '') {
        return { ok: false, reason: 'No directory is configured for this source.' }
      }
      return { ok: true, reason: null }
    },

    async poll(): Promise<InboundPoll> {
      try {
        const entries = await readdir(options.directory, { withFileTypes: true })
        const files = entries
          .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, MAX_PER_POLL)

        const messages: InboundMessage[] = []
        for (const filename of files) {
          const path = join(options.directory, filename)
          const bytes = new Uint8Array(await readFile(path))
          const when = (await stat(path)).mtime.toISOString()

          // The filename is the arrival's identity. Two files with the same name
          // cannot coexist in a directory, which is exactly the property an
          // external id needs.
          messages.push(
            extname(filename).toLowerCase() === '.eml'
              ? await messageFromRfc822(bytes, { externalId: filename, receivedAt: when })
              : messageFromDocument({
                  externalId: filename,
                  source,
                  filename,
                  contentType: contentTypeFor(filename),
                  bytes,
                  receivedFrom: null,
                  subject: filename,
                  receivedAt: when,
                }),
          )
        }

        return { source: name, ok: true, messages, failure: null, cursor: null }
      } catch (error: unknown) {
        // A directory that is not there is a configuration problem, not an
        // error in the books. Nothing throws upwards.
        return {
          source: name,
          ok: false,
          messages: [],
          failure: error instanceof Error ? error.message : String(error),
          cursor: null,
        }
      }
    },

    async acknowledge(externalIds: readonly string[]): Promise<void> {
      if (externalIds.length === 0) return
      await mkdir(processedDirectory, { recursive: true })

      for (const filename of externalIds) {
        // Only ever a name within this directory. A poll produced these, but an
        // external id reaching a filesystem path deserves the check anyway.
        if (filename !== basename(filename)) continue
        try {
          await rename(join(options.directory, filename), join(processedDirectory, filename))
        } catch {
          // Already moved, or taken away by hand. Either way there is nothing
          // to do and nothing worth failing a whole poll over.
        }
      }
    },
  }
}
