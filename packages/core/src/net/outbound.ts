import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/**
 * Outbound host checks for webhook delivery and IMAP (audit M1, L4).
 *
 * A subscriber URL that is `https://` at registration can still 302 onto a
 * link-local metadata service, and an IMAP host is whatever somebody typed.
 * Resolving the name and refusing private, link-local and loopback addresses
 * closes the blind SSRF; `redirect: 'manual'` on webhook fetch closes the
 * redirect half.
 *
 * `KLOPT_ALLOW_PRIVATE_OUTBOUND=1` is the explicit local-dev escape hatch —
 * IMAP against a mailcow on the LAN, a webhook into another container on the
 * same compose network. Production does not set it.
 */

export class PrivateOutboundError extends Error {
  constructor(target: string, detail: string) {
    super(`Refusing to reach ${target}: ${detail}`)
    this.name = 'PrivateOutboundError'
  }
}

/** Whether the escape hatch is on. Read at call time so tests can flip it. */
function privateOutboundAllowed(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment['KLOPT_ALLOW_PRIVATE_OUTBOUND'] === '1'
}

/**
 * True when the address must not be dialled from a multi-tenant or internet-
 * facing instance.
 *
 * Covers IPv4 and IPv6 loopback, link-local (including the cloud metadata
 * range), unique-local, and the IPv4-mapped forms of each.
 */
export function isBlockedIp(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false

  if (family === 4) return isBlockedV4(address)

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded v4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (mapped !== null) return isBlockedV4(mapped[1]!)

  const lower = address.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  // fe80::/10 link-local, fc00::/7 unique local, ff00::/8 multicast.
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('ff')) return true
  return false
}

function isBlockedV4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a, b] = parts as [number, number, number, number]

  if (a === 0) return true // "this" network
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true // shared address space (CGNAT)
  if (a >= 224) return true // multicast and reserved
  return false
}

/**
 * Resolve a hostname (or accept an IP literal) and refuse blocked addresses.
 */
export async function assertSafeHostname(
  hostname: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  // Escape hatch first: local mailboxes and compose-network webhooks.
  if (privateOutboundAllowed(environment)) return

  const host = hostname.trim().toLowerCase()
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    throw new PrivateOutboundError(hostname, 'loopback and localhost names are not allowed.')
  }

  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) {
      throw new PrivateOutboundError(hostname, 'that address is private, link-local or loopback.')
    }
    return
  }

  let addresses: readonly string[]
  try {
    const records = await lookup(host, { all: true, verbatim: true })
    addresses = records.map((record) => record.address)
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new PrivateOutboundError(hostname, `the name could not be resolved (${reason}).`)
  }

  if (addresses.length === 0) {
    throw new PrivateOutboundError(hostname, 'the name resolved to no addresses.')
  }

  const blocked = addresses.filter((address) => isBlockedIp(address))
  if (blocked.length > 0) {
    throw new PrivateOutboundError(
      hostname,
      `it resolves to a private, link-local or loopback address (${blocked.join(', ')}).`,
    )
  }
}

/**
 * An https URL whose host is safe to dial. Used at webhook registration and
 * again at delivery, so a DNS change between the two cannot sneak a private
 * target in.
 */
export async function assertSafeHttpsUrl(
  value: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PrivateOutboundError(value, 'that is not a URL.')
  }

  if (url.protocol !== 'https:') {
    throw new PrivateOutboundError(value, 'only https:// URLs are allowed.')
  }

  await assertSafeHostname(url.hostname, environment)
}
