import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { entryPoints } from '../src/commands/serve.js'
import { serve } from '../src/commands/serve.js'

/**
 * `klopt serve` finds two files and spawns them (spec 10.1).
 *
 * The spawning is not tested here — a test that starts a real server and a
 * real worker is the walk-through in ADR 0042, and a test that mocks
 * `child_process` would assert that the mock was called. What is worth holding
 * still is the search order, because it is the difference between a container
 * that boots and one that says it cannot find the server: the image path has
 * to beat the repository paths, and an explicit environment variable has to
 * beat both.
 */

const nothing = () => false
const everything = () => true

describe('finding the entry points', () => {
  it('takes the environment over anything it can find', () => {
    // The container images set both, so the layout of an image is never this
    // file's guess.
    const env = {
      KLOPT_SERVER_ENTRY: '/app/apps/web/.output/server/index.mjs',
      KLOPT_WORKER_ENTRY: '/app/apps/worker/dist/main.js',
    }
    expect(entryPoints(env, '/repo', everything)).toEqual({
      server: '/app/apps/web/.output/server/index.mjs',
      worker: '/app/apps/worker/dist/main.js',
    })
  })

  it('ignores an override that points at nothing', () => {
    // Falling through rather than failing: a stale variable in a shell profile
    // should not stop a checkout that is otherwise fine from starting.
    const env = { KLOPT_SERVER_ENTRY: '/gone/server.mjs' }
    expect(entryPoints(env, '/repo', (path) => !path.startsWith('/gone')).server).toBe(
      '/repo/apps/web/.output/server/index.mjs',
    )
  })

  it('finds both from the repository root', () => {
    const { server, worker } = entryPoints({}, '/repo', everything)
    expect(server).toBe('/repo/apps/web/.output/server/index.mjs')
    expect(worker).toBe('/repo/apps/worker/dist/main.js')
  })

  it('finds both from apps/web, which is where the server is built', () => {
    const built = (path: string) =>
      path === '/repo/apps/web/.output/server/index.mjs' ||
      path === '/repo/apps/worker/dist/main.js'
    const { server, worker } = entryPoints({}, '/repo/apps/web', built)
    expect(server).toBe('/repo/apps/web/.output/server/index.mjs')
    expect(worker).toBe('/repo/apps/worker/dist/main.js')
  })

  it('never resolves the worker to a bare dist/main.js under the cwd', () => {
    // Run from `apps/cli`, such a candidate is this binary. Spawning it as the
    // worker prints the usage, exits 0, and the "one child down stops the
    // other" rule then takes the API with it — a container that boots, logs
    // nothing alarming, and serves nothing.
    const cliOnly = (path: string) => path === '/repo/apps/cli/dist/main.js'
    expect(entryPoints({}, '/repo/apps/cli', cliOnly).worker).toBeNull()
  })

  it('reports nothing found rather than guessing', () => {
    expect(entryPoints({}, '/repo', nothing)).toEqual({ server: null, worker: null })
  })
})

describe('the command', () => {
  it('refuses to start with no server, and says how to get one', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'klopt-serve-'))
    const before = process.cwd()
    const lines: string[] = []
    try {
      // An empty directory, so no candidate resolves and the failure is the
      // real one rather than a mock's.
      process.chdir(empty)
      const code = await serve.run({
        client: null,
        args: { positional: [], options: {} },
        out: () => {},
        err: (line) => lines.push(line),
        prompt: () => Promise.reject(new Error('no terminal')),
      })
      expect(code).toBe(2)
      expect(lines.join('\n')).toContain('KLOPT_SERVER_ENTRY')
    } finally {
      process.chdir(before)
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('declares the options it takes, so the strict parser accepts them', () => {
    expect(serve.options).toEqual({ headless: 'boolean', port: 'string', 'no-worker': 'boolean' })
    // Not a value option. `--port 3000` needs a value; `--headless 3000` would
    // otherwise swallow the next word and start on the default port.
    expect(serve.options?.['headless']).toBe('boolean')
  })

  it('needs no credentials', () => {
    expect(serve.anonymous).toBe(true)
  })
})
