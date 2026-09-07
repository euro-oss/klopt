import type { InboundSource } from '@klopt/core'
import { createImapSource } from './imap.js'
import { createMaildirSource } from './maildir.js'

/**
 * Building a source from what was configured for it.
 *
 * The configuration arrives as `jsonb`, which is to say as `unknown`, and this
 * is the one place it becomes something typed. Reading it defensively rather
 * than casting matters because the row may have been written by a older version
 * of this code, or by hand — and a missing host should produce a source that
 * says "no host is configured" rather than one that throws inside a poller
 * nobody is watching.
 */

export interface StoredInboundSource {
  readonly kind: 'maildir' | 'imap' | 'peppol'
  readonly name: string
  readonly config: Record<string, unknown>
  readonly secret: string | null
}

function text(config: Record<string, unknown>, key: string, fallback = ''): string {
  const value = config[key]
  return typeof value === 'string' ? value : fallback
}

function optionalText(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function number(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function flag(config: Record<string, unknown>, key: string): boolean | undefined {
  const value = config[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * The adapter for a configured source, or null when there is none.
 *
 * `peppol` returns null on purpose: an access point *delivers*, it is not
 * polled. Its documents arrive at `POST /api/v1/inbox` with `source=peppol` and
 * the transmission id as the external id, which is the same doorway and the
 * same deduplication. The row exists so the screen can show that the connection
 * is configured and what has come through it.
 */
export function createInboundSource(row: StoredInboundSource): InboundSource | null {
  switch (row.kind) {
    case 'maildir':
      return createMaildirSource({
        directory: text(row.config, 'directory'),
        name: row.name,
        source: text(row.config, 'source') === 'peppol' ? 'peppol' : 'email',
      })

    case 'imap':
      return createImapSource({
        host: text(row.config, 'host'),
        port: number(row.config, 'port'),
        secure: flag(row.config, 'secure'),
        user: text(row.config, 'user'),
        password: row.secret ?? '',
        mailbox: optionalText(row.config, 'mailbox'),
        processedMailbox: optionalText(row.config, 'processedMailbox') ?? null,
        name: row.name,
      })

    case 'peppol':
      return null
  }
}
