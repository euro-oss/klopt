import type { Client } from '../client.js'

/**
 * Every command, and the operation each one calls.
 *
 * Spec 10.4's rule, stated as data so a test can hold us to it:
 *
 * > No operation exists only in the CLI.
 *
 * Each command names the domain operations it reaches. `registry.test.ts`
 * checks every one of those ids against `OPERATIONS` in `@klopt/core` and
 * fails the build on a name that is not there. A command that did something
 * the API cannot would have nothing to declare, and that is the point: it
 * becomes impossible to add one without either lying in this file or adding
 * the operation first.
 *
 * `operations: []` is for the two commands that are genuinely not domain
 * operations — signing in and signing out are better-auth's surface, not
 * `/api/v1` — and the test requires those to say so by name rather than by
 * being an empty list nobody looked at.
 */

export interface CommandContext {
  /** Absent for `login`, which is how you get one. */
  readonly client: Client | null
  readonly args: Args
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  /** Reads a line from the terminal. Injected so tests need no tty. */
  readonly prompt: (question: string) => Promise<string>
}

export interface Args {
  readonly positional: readonly string[]
  readonly options: Readonly<Record<string, string | boolean>>
}

/**
 * What an option is, so the parser knows whether it takes a value.
 *
 * Declared per command rather than globally, and `parseArgs` is run in strict
 * mode against it. Without this, `--year 2026` parses as the flag `year` plus
 * a stray positional `2026` — silently, and the command then behaves as though
 * no year was given. Every option here takes a value unless it says otherwise.
 */
export type OptionSpec = Readonly<Record<string, 'string' | 'boolean'>>

export interface Command {
  readonly name: string
  readonly summary: string
  /** One line of usage, shown by `klopt help`. */
  readonly usage: string
  readonly options?: OptionSpec
  /** The domain operations this reaches. Empty only for the auth commands. */
  readonly operations: readonly string[]
  /** True when it works without credentials. */
  readonly anonymous?: boolean
  run(context: CommandContext): Promise<number>
}

/** The commands that legitimately touch no `/api/v1` operation, and why. */
export const NOT_DOMAIN_OPERATIONS: Readonly<Record<string, string>> = {
  login: 'better-auth’s own endpoints, which are not under /api/v1 and are not versioned by us.',
  logout: 'Deletes a local file. It reaches nothing at all.',
  help: 'Prints this list.',
  serve:
    'Starts the API and the worker (spec 10.1). Process management, not domain access — it spawns two entry points and reaches nothing itself.',
}

export function optionOf(args: Args, name: string): string | undefined {
  const value = args.options[name]
  return typeof value === 'string' ? value : undefined
}

export function flagOf(args: Args, name: string): boolean {
  return args.options[name] === true
}

/** A required option, refused by name rather than by a stack trace. */
export function requireOption(args: Args, name: string): string {
  const value = optionOf(args, name)
  if (value === undefined || value === '') {
    throw new Error(`--${name} is required.`)
  }
  return value
}
