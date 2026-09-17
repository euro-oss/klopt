import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Where `klopt login` puts what it got back.
 *
 * A file rather than an environment variable, because a session is obtained
 * interactively and has to outlive the shell that obtained it. `KLOPT_TOKEN`
 * still wins when it is set — that is the path a cron job or a CI step takes,
 * and a machine should not be reading somebody's login.
 *
 * Written 0600 and created inside a 0700 directory. It holds a credential that
 * opens seven years of somebody's books; a world-readable file in a shared home
 * directory is the kind of thing nobody notices until it matters.
 */

export interface Session {
  readonly url: string
  readonly cookie: string
  readonly email: string
}

/** `$XDG_CONFIG_HOME/klopt/session.json`, or the usual place. */
export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['XDG_CONFIG_HOME'] ?? join(env['HOME'] ?? homedir(), '.config')
  return join(base, 'klopt', 'session.json')
}

export function readSession(path = sessionPath()): Session | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Session>
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.cookie !== 'string' ||
      typeof parsed.email !== 'string'
    ) {
      return null
    }
    return { url: parsed.url, cookie: parsed.cookie, email: parsed.email }
  } catch {
    // Absent, unreadable or not JSON. All three mean "not signed in", and
    // there is nothing an operator can do with the distinction.
    return null
  }
}

export function writeSession(session: Session, path = sessionPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 })
  // `writeFileSync`'s mode only applies when it creates the file. An existing
  // one keeps whatever it had, which may be whatever an earlier version wrote.
  chmodSync(path, 0o600)
}

export function clearSession(path = sessionPath()): void {
  rmSync(path, { force: true })
}
