import type { Command } from './registry.js'
import { bankImport } from './bank.js'
import { check } from './check.js'
import { events, webhooksReplay } from './webhooks.js'
import { exportAuditFile } from './export.js'
import { login, logout } from './login.js'
import { serve } from './serve.js'

/**
 * The command list, which is spec 10.4's list.
 *
 * > It is what a self-hoster actually needs at 23:00: create the first user,
 * > run a backup, export an XAF, replay a webhook, import a statement, run the
 * > reconciliation check.
 *
 * All six, in that order of need:
 *
 *   - create the first user → `login`, which drives the same sign-in a browser
 *     does, so no privileged path had to exist for it
 *   - run a backup, export an XAF → `export`, which are the same act here
 *   - replay a webhook → `webhooks-replay`
 *   - import a statement → `bank-import`
 *   - the reconciliation check → `check`
 *
 * Plus `events`, because the question that precedes replaying a webhook is
 * always "what did we actually send", and `serve` from spec 10.1 — the
 * deployment mode rather than one of 10.4's six, but the same binary is the
 * right place for it.
 */
export const COMMANDS: readonly Command[] = [
  serve,
  login,
  logout,
  check,
  exportAuditFile,
  bankImport,
  webhooksReplay,
  events,
]

export function commandNamed(name: string): Command | undefined {
  return COMMANDS.find((command) => command.name === name)
}
