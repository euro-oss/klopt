import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from './registry.js'
import { flagOf, optionOf } from './registry.js'

/**
 * Starting the thing (spec 10.1).
 *
 * > `klopt serve --headless` starts the API and the worker with no web app
 * > mounted.
 *
 * Two processes, not one. The worker does slow, retrying, scheduled work —
 * polling mailboxes, pulling ten years of documents out of Exact, sealing a
 * book year at four in the morning — and putting that on the same event loop
 * as a request means a long job makes the API late. They are already separate
 * in development and in the compose file; this starts both and holds them
 * together so an operator has one thing to stop.
 *
 * ## Why this is in the CLI and still not a privileged path
 *
 * It spawns processes; it does not talk to the database, and the lint config
 * still forbids importing one. `serve` knows two file paths and an
 * environment, which is process management rather than domain access — the
 * distinction the rule in spec 10.1 is actually about.
 *
 * ## Signals
 *
 * SIGINT and SIGTERM go to both children, and the exit code is the first
 * child's. A container runtime sends SIGTERM and then loses patience; a
 * supervisor that swallowed it would turn every deploy into a kill -9, and
 * the worker is in the middle of a transaction often enough for that to
 * matter.
 */

/**
 * Where the built server and worker are.
 *
 * Both found by path rather than by `require.resolve`, and deliberately: the
 * worker depends on `@klopt/db`, so making it a dependency of this package
 * would pull a database driver into the CLI's tree to run a file it only ever
 * spawns. The lint rule forbids *importing* one; not depending on one at all
 * is the version that survives somebody being clever later.
 *
 * `KLOPT_SERVER_ENTRY` and `KLOPT_WORKER_ENTRY` come first, and the container
 * images set both. An image that declares its own layout is one this file
 * cannot be wrong about; the remaining candidates are for a checkout, where
 * `klopt serve` should work from the root or from `apps/web` without being
 * told anything.
 *
 * Every candidate names its package. A bare `<cwd>/dist/main.js` would, run
 * from `apps/cli`, resolve to this very binary — the CLI spawned as the
 * worker, printing its usage and exiting 0.
 */
export function entryPoints(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): { server: string | null; worker: string | null } {
  const first = (candidates: (string | undefined)[]): string | null =>
    candidates.filter((path): path is string => path !== undefined).find(exists) ?? null

  return {
    server: first([
      env['KLOPT_SERVER_ENTRY'],
      join(cwd, 'apps', 'web', '.output', 'server', 'index.mjs'),
      join(cwd, '.output', 'server', 'index.mjs'),
    ]),
    worker: first([
      env['KLOPT_WORKER_ENTRY'],
      join(cwd, 'apps', 'worker', 'dist', 'main.js'),
      join(cwd, '..', 'worker', 'dist', 'main.js'),
    ]),
  }
}

export const serve: Command = {
  name: 'serve',
  summary: 'Start the API and the worker. --headless mounts no web app.',
  usage: 'klopt serve [--headless] [--port 3000] [--no-worker]',
  options: { headless: 'boolean', port: 'string', 'no-worker': 'boolean' },
  operations: [],
  anonymous: true,

  run({ args, out, err }) {
    const { server, worker } = entryPoints()

    if (server === null) {
      err('Could not find the built server.')
      err('Run `pnpm --filter @klopt/web build`, or set KLOPT_SERVER_ENTRY.')
      return Promise.resolve(2)
    }

    // The flag or the variable. The headless image sets the variable, because
    // that is what the middleware reads and an image should not depend on the
    // arguments somebody remembers to pass it; the flag is for a checkout. A
    // run that is headless one way and reports itself as the other is how an
    // operator spends an afternoon on a 404.
    const headless = flagOf(args, 'headless') || process.env['KLOPT_HEADLESS'] === '1'
    const port = optionOf(args, 'port') ?? process.env['PORT'] ?? '3000'

    const children: ChildProcess[] = []

    const start = (name: string, entry: string, extra: Record<string, string>): ChildProcess => {
      const child = spawn(process.execPath, [entry], {
        // Inherited, so the logs of both land in the same place a container
        // runtime is already collecting from.
        stdio: 'inherit',
        env: { ...process.env, ...extra },
      })
      child.on('exit', (code, signal) => {
        out(`[${name}] exited ${signal ?? String(code ?? 0)}`)
        // One down means the deployment is broken. Taking the other with it is
        // what makes a restart policy work; leaving a half-alive container is
        // how an instance serves requests for a week with no worker.
        stop(signal ?? 'SIGTERM')
      })
      return child
    }

    let stopping = false
    const stop = (signal: NodeJS.Signals): void => {
      if (stopping) return
      stopping = true
      for (const child of children) child.kill(signal)
    }

    children.push(
      start('api', server, {
        PORT: port,
        ...(headless ? { KLOPT_HEADLESS: '1' } : {}),
      }),
    )

    if (!flagOf(args, 'no-worker')) {
      if (worker === null) err('[worker] not installed; starting the API alone.')
      else children.push(start('worker', worker, {}))
    }

    out(
      headless
        ? `Klopt is up on :${port}, headless. Only /api and /.well-known answer.`
        : `Klopt is up on :${port}.`,
    )

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        stop(signal)
      })
    }

    // Resolves when the first child goes, which `stop` then makes true of all
    // of them. The exit code is that child's.
    return new Promise<number>((resolve) => {
      const first = children[0]
      if (first === undefined) {
        resolve(1)
        return
      }
      first.on('exit', (code) => {
        resolve(code ?? 0)
      })
    })
  },
}
