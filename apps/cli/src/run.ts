import { parseArgs } from 'node:util'
import { createClient, ApiError, type Fetch } from './client.js'
import { COMMANDS, commandNamed } from './commands/index.js'
import type { Args, CommandContext } from './commands/registry.js'
import { readSession } from './session.js'

/**
 * Parsing, dispatch and the exit code.
 *
 * Separated from `main.ts` so that the whole of it can be driven by a test
 * without spawning a process: everything it touches — argv, the environment,
 * `fetch`, stdout, the terminal — arrives as an argument.
 */

export interface RunOptions {
  readonly argv: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  readonly fetch?: Fetch
  readonly prompt?: (question: string) => Promise<string>
}

function usage(out: (line: string) => void): void {
  out('klopt — the operator’s surface for a Klopt instance.\n')
  out('Usage: klopt <command> [options]\n')

  const width = Math.max(...COMMANDS.map((command) => command.name.length))
  for (const command of COMMANDS) {
    out(`  ${command.name.padEnd(width)}  ${command.summary}`)
  }

  out('\nEvery command talks to the same public API the web app uses.')
  out('Point it somewhere with --url or KLOPT_URL; authenticate with `klopt login`')
  out('or by setting KLOPT_TOKEN to a scoped API token.\n')

  for (const command of COMMANDS) out(`  ${command.usage}`)
}

export async function run(options: RunOptions): Promise<number> {
  const [name, ...rest] = options.argv

  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    usage(options.out)
    return 0
  }

  const command = commandNamed(name)
  if (command === undefined) {
    options.err(`No such command: ${name}`)
    options.err('Run `klopt help` for the list.')
    return 2
  }

  let args: Args
  try {
    // Strict, against what the command declares. The alternative — a
    // permissive parse — turns `--year 2026` into the flag `year` and a stray
    // positional, and the command then runs as though no year was given.
    const parsed = parseArgs({
      args: [...rest],
      strict: true,
      allowPositionals: true,
      options: Object.fromEntries(
        Object.entries({ url: 'string' as const, ...(command.options ?? {}) }).map(
          ([name, type]) => [name, { type }],
        ),
      ),
    })
    args = {
      positional: parsed.positionals,
      options: parsed.values as Record<string, string | boolean>,
    }
  } catch (cause: unknown) {
    options.err(cause instanceof Error ? cause.message : String(cause))
    return 2
  }

  const context: CommandContext = {
    client: command.anonymous === true ? null : clientFor(options, args),
    args,
    out: options.out,
    err: options.err,
    prompt:
      options.prompt ??
      (() => Promise.reject(new Error('This command needs a terminal to ask a question.'))),
  }

  try {
    return await command.run(context)
  } catch (cause: unknown) {
    if (cause instanceof ApiError) {
      options.err(cause.message)
      for (const violation of cause.violations) {
        options.err(`  ${violation.path ?? '—'}: ${violation.message}`)
      }
      // 77 is EX_NOPERM by sysexits convention, which a script can branch on
      // to tell "your token is wrong" from "the request was".
      return cause.status === 401 || cause.status === 403 ? 77 : 1
    }

    options.err(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

/**
 * Where the credentials come from, in order.
 *
 * `KLOPT_TOKEN` beats a stored session on purpose: a machine — cron, CI, a
 * container — should run as itself with a scoped token, not as whoever last
 * logged in on that host.
 */
function clientFor(options: RunOptions, args: Args) {
  const token = options.env['KLOPT_TOKEN']
  const flagUrl = typeof args.options['url'] === 'string' ? args.options['url'] : undefined
  const url = flagUrl ?? options.env['KLOPT_URL']

  if (token !== undefined && token !== '') {
    if (url === undefined || url === '') return null
    return createClient({ url, token }, options.fetch)
  }

  const session = readSession()
  if (session === null) return null

  return createClient({ url: url ?? session.url, cookie: session.cookie }, options.fetch)
}
