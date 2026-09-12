import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/run.js'

/**
 * The CLI, driven end to end without a process or a network.
 *
 * `run` takes argv, the environment, `fetch`, both streams and the prompt as
 * arguments, so everything below is an ordinary function call. The exit codes
 * matter as much as the output: this is a thing people put in cron.
 */

let config: string

beforeEach(() => {
  // Its own XDG_CONFIG_HOME, so a test never reads or writes the developer's
  // real session file.
  config = mkdtempSync(join(tmpdir(), 'klopt-cli-'))
})

afterEach(() => {
  rmSync(config, { recursive: true, force: true })
})

interface Call {
  readonly url: string
  readonly method: string
  readonly body: unknown
  readonly headers: Record<string, string>
}

/** A Klopt that answers from a fixture and remembers what was asked. */
function fakeApi(routes: Record<string, { status?: number; body?: unknown; text?: string }>) {
  const calls: Call[] = []

  const fetch = ((input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    })

    const path = new URL(url).pathname
    const match = routes[`${method} ${path}`] ?? routes[path]
    if (match === undefined) return Promise.resolve(new Response(null, { status: 404 }))

    if (match.text !== undefined) {
      return Promise.resolve(new Response(match.text, { status: match.status ?? 200 }))
    }
    return Promise.resolve(
      new Response(JSON.stringify(match.body ?? {}), {
        status: match.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }) as unknown as typeof globalThis.fetch

  return { calls, fetch }
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    write: (line: string) => out.push(line),
    fail: (line: string) => err.push(line),
  }
}

const envWith = (extra: Record<string, string> = {}) => ({
  XDG_CONFIG_HOME: config,
  KLOPT_URL: 'https://books.example.test',
  ...extra,
})

describe('the command surface', () => {
  it('prints the commands and exits 0 with no arguments', async () => {
    const io = capture()
    const code = await run({ argv: [], env: envWith(), out: io.write, err: io.fail })

    expect(code).toBe(0)
    const text = io.out.join('\n')
    for (const command of ['login', 'export', 'bank-import', 'webhooks-replay', 'check']) {
      expect(text).toContain(command)
    }
  })

  it('refuses an unknown command by name, and exits 2', async () => {
    const io = capture()
    const code = await run({ argv: ['frobnicate'], env: envWith(), out: io.write, err: io.fail })

    expect(code).toBe(2)
    expect(io.err.join('\n')).toContain('frobnicate')
  })

  it('reads an option that takes a value, rather than as a flag and a stray word', async () => {
    // The bug this guards: a permissive `parseArgs` turns `--year 2025` into
    // the flag `year` plus the positional `2025`, so the command runs as
    // though no year was given — silently, and against the current one.
    const io = capture()
    const api = fakeApi({
      'GET /api/v1/ledger/chain-verification': { body: { verified: true, entryCount: 1 } },
      'GET /api/v1/reports/trial-balance': { body: { difference: '0' } },
      'GET /api/v1/rgs/coverage': { body: { unmappedCount: 0, accountCount: 1 } },
    })

    await run({
      argv: ['check', '--year', '2025'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(api.calls.some((call) => call.url.includes('fiscalYear=2025'))).toBe(true)
  })

  it('refuses an option the command does not take, by name', async () => {
    const io = capture()
    const code = await run({
      argv: ['check', '--commit'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
    })

    expect(code).toBe(2)
    expect(io.err.join('\n')).toContain('commit')
  })

  it('says what to do when there are no credentials', async () => {
    const io = capture()
    const code = await run({
      argv: ['check'],
      env: { XDG_CONFIG_HOME: config, KLOPT_URL: 'https://books.example.test' },
      out: io.write,
      err: io.fail,
    })

    expect(code).toBe(1)
    expect(io.err.join('\n')).toContain('klopt login')
  })
})

describe('check', () => {
  const healthy = {
    'GET /api/v1/ledger/chain-verification': {
      body: { verified: true, entryCount: 12, headHash: 'abc123def4567890' },
    },
    'GET /api/v1/reports/trial-balance': {
      body: { difference: '0', totalDebit: '1.210,00', totalCredit: '1.210,00' },
    },
    'GET /api/v1/rgs/coverage': {
      body: { mappedCount: 31, accountCount: 31, unmappedCount: 0, version: '3.7' },
    },
  }

  it('exits 0 and reports three lines when the books are sound', async () => {
    const io = capture()
    const api = fakeApi(healthy)

    const code = await run({
      argv: ['check'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(0)
    expect(io.out.join('\n')).toContain('chain      ok')
    expect(io.out.join('\n')).toContain('balance    ok')
    expect(io.out.join('\n')).toContain('rgs        ok')
  })

  it('exits 1 when the hash chain does not verify', async () => {
    // The whole reason this is one command rather than three: it goes in cron,
    // and cron reads the exit code.
    const io = capture()
    const api = fakeApi({
      ...healthy,
      'GET /api/v1/ledger/chain-verification': { body: { verified: false, entryCount: 12 } },
    })

    const code = await run({
      argv: ['check'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(1)
    expect(io.out.join('\n')).toContain('BROKEN')
  })

  it('exits 1 when the trial balance does not net to zero', async () => {
    const io = capture()
    const api = fakeApi({
      ...healthy,
      'GET /api/v1/reports/trial-balance': { body: { difference: '1.470.000,00' } },
    })

    const code = await run({
      argv: ['check'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(1)
    expect(io.out.join('\n')).toContain('OFF BY')
  })

  it('still exits 0 when accounts are unmapped, which is incomplete not wrong', async () => {
    // Exiting 1 for this would train somebody to ignore the exit code of the
    // one command whose job is to be believed.
    const io = capture()
    const api = fakeApi({
      ...healthy,
      'GET /api/v1/rgs/coverage': { body: { accountCount: 31, unmappedCount: 4, version: '3.7' } },
    })

    const code = await run({
      argv: ['check'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(0)
    expect(io.out.join('\n')).toContain('partial')
  })

  it('sends the token as a bearer, and asks the right routes', async () => {
    const io = capture()
    const api = fakeApi(healthy)

    await run({
      argv: ['check', '--year', '2025'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(api.calls.every((call) => call.headers['authorization'] === 'Bearer klopt_test')).toBe(
      true,
    )
    expect(api.calls.some((call) => call.url.includes('fiscalYear=2025'))).toBe(true)
  })
})

describe('bank-import', () => {
  const accounts = {
    'GET /api/v1/bank-accounts': {
      body: { accounts: [{ id: 'acc-1', name: 'Rekening-courant', iban: 'NL02ABNA0123456789' }] },
    },
  }

  it('is a dry run unless told otherwise', async () => {
    // A command that silently imported forty-two transactions because somebody
    // got a path wrong would be worse than the screen it replaces.
    const io = capture()
    const api = fakeApi({
      ...accounts,
      'POST /api/v1/bank-statements': {
        body: { format: 'mt940', newEntries: 3, duplicates: 39 },
      },
    })

    const file = join(config, 'statement.mt940')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, ':20:TEST\n')

    const code = await run({
      argv: ['bank-import', '--file', file],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(0)
    const post = api.calls.find((call) => call.method === 'POST')!
    expect((post.body as { dryRun: boolean }).dryRun).toBe(true)
    expect(io.out.join('\n')).toContain('Nothing was imported')
  })

  it('imports for real with --commit, and picks the only account', async () => {
    const io = capture()
    const api = fakeApi({
      ...accounts,
      'POST /api/v1/bank-statements': { body: { imported: 3, duplicates: 39 } },
    })

    const file = join(config, 'statement.mt940')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, ':20:TEST\n')

    const code = await run({
      argv: ['bank-import', '--file', file, '--commit'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(0)
    const post = api.calls.find((call) => call.method === 'POST')!
    expect((post.body as { dryRun: boolean; bankAccountId: string }).dryRun).toBe(false)
    expect((post.body as { bankAccountId: string }).bankAccountId).toBe('acc-1')
    expect(io.out.join('\n')).toContain('Imported 3')
  })

  it('carries an idempotency key, because this is the client run twice', async () => {
    const io = capture()
    const api = fakeApi({ ...accounts, 'POST /api/v1/bank-statements': { body: { imported: 0 } } })

    const file = join(config, 'statement.mt940')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, ':20:TEST\n')

    await run({
      argv: ['bank-import', '--file', file, '--commit'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    const post = api.calls.find((call) => call.method === 'POST')!
    expect(post.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('refusals', () => {
  it('prints the problem document rather than the status line', async () => {
    // "400 Bad Request" is not an API, and it is not a CLI either.
    const io = capture()
    const api = fakeApi({
      'GET /api/v1/ledger/chain-verification': {
        status: 422,
        body: {
          detail: 'There is no book year 2019 in this administration.',
          code: 'validation_failed',
          violations: [{ path: 'fiscalYear', message: 'Unknown book year.' }],
        },
      },
    })

    const code = await run({
      argv: ['check'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(1)
    expect(io.err.join('\n')).toContain('no book year 2019')
    expect(io.err.join('\n')).toContain('fiscalYear')
  })

  it('exits 77 when the token is refused, so a script can tell that apart', async () => {
    const io = capture()
    const api = fakeApi({
      'GET /api/v1/ledger/chain-verification': {
        status: 403,
        body: { detail: 'This token does not have ledger:read.', code: 'forbidden' },
      },
    })

    const code = await run({
      argv: ['check'],
      env: envWith({ KLOPT_TOKEN: 'klopt_test' }),
      out: io.write,
      err: io.fail,
      fetch: api.fetch,
    })

    expect(code).toBe(77)
  })
})
