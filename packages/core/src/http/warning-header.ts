/**
 * Soft-warning messages on file downloads (XAF) travel in an HTTP header.
 * Raw JSON breaks when a message contains non-ASCII (é, ë, €). Percent-encode
 * the UTF-8 JSON so the header stays ASCII; clients decode before display.
 */

export const KLOPT_WARNING_MESSAGES_HEADER = 'x-klopt-warning-messages'

/** ASCII-safe header value for a list of warning messages. */
export function encodeWarningMessagesHeader(messages: readonly string[]): string {
  return encodeURIComponent(JSON.stringify(messages))
}

/** Decode a value produced by {@link encodeWarningMessagesHeader}, or legacy raw JSON. */
export function decodeWarningMessagesHeader(raw: string): readonly string[] {
  if (raw === '') return []
  try {
    const decoded = raw.includes('%') ? decodeURIComponent(raw) : raw
    const parsed: unknown = JSON.parse(decoded)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}
