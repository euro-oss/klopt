import { describe, expect, it } from 'vitest'
import { listOperations } from '@klopt/core'
import { COMMANDS } from '../src/commands/index.js'
import { NOT_DOMAIN_OPERATIONS } from '../src/commands/registry.js'

/**
 * Spec 10.4's one hard rule, enforced:
 *
 * > No operation exists only in the CLI.
 *
 * A command that did something the API cannot would have no operation id to
 * declare. It becomes impossible to add one without either lying in the
 * registry or adding the operation to `@klopt/core` first — which is the order
 * that keeps the UI, the MCP server and this from drifting apart.
 */

const KNOWN = new Set(listOperations().map((operation) => operation.id))

describe('every command is a client of the public API', () => {
  it('names only operations that exist', () => {
    const invented = COMMANDS.flatMap((command) =>
      command.operations.filter((id) => !KNOWN.has(id)).map((id) => `${command.name}: ${id}`),
    )

    expect(invented).toEqual([])
  })

  it('makes a command with no operation say why, by name', () => {
    // The escape hatch has to be deliberate. An empty array is what you get by
    // forgetting; an entry in `NOT_DOMAIN_OPERATIONS` is what you get by
    // deciding, and a reviewer can see the difference.
    const unexplained = COMMANDS.filter(
      (command) => command.operations.length === 0 && !(command.name in NOT_DOMAIN_OPERATIONS),
    ).map((command) => command.name)

    expect(unexplained).toEqual([])
  })

  it('does not explain away a command that does reach the API', () => {
    // The other direction: an exemption left behind after a command grew an
    // operation would quietly stop the first test from covering it.
    const stale = COMMANDS.filter(
      (command) => command.operations.length > 0 && command.name in NOT_DOMAIN_OPERATIONS,
    ).map((command) => command.name)

    expect(stale).toEqual([])
  })

  it('covers every job spec 10.4 names', () => {
    // The list, verbatim: "create the first user, run a backup, export an XAF,
    // replay a webhook, import a statement, run the reconciliation check."
    const names = new Set(COMMANDS.map((command) => command.name))

    expect(names).toContain('login') // create the first user
    expect(names).toContain('export') // run a backup, export an XAF
    expect(names).toContain('webhooks-replay') // replay a webhook
    expect(names).toContain('bank-import') // import a statement
    expect(names).toContain('check') // run the reconciliation check
  })

  it('gives every command a usage line that starts with its own name', () => {
    for (const command of COMMANDS) {
      expect(command.usage.startsWith(`klopt ${command.name}`), command.name).toBe(true)
      expect(command.summary.length).toBeGreaterThan(10)
    }

    const names = COMMANDS.map((command) => command.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
