import { describe, expect, it, vi } from 'vitest'
import type { ExactTokens } from '@klopt/core'
import { collectAll, createExactClient, ExactApiError, readDivision } from '../../src/index.js'

/**
 * The REST client, and the three ways a real connection breaks.
 *
 * **The refresh token is single-use.** Two pages noticing an expired token at
 * once would each spend it and only one would win. And a new pair that is used
 * before it is stored leaves a dead refresh token in the database if the
 * process dies in between.
 *
 * **Exact pages.** A client that trusted `$top` would import part of a chart of
 * accounts and report success.
 *
 * **Exact throttles.** The remaining budget is on every response, so being
 * throttled is avoidable rather than something to discover.
 */

const tokens = (overrides: Partial<ExactTokens> = {}): ExactTokens => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-09-08T12:10:00.000Z',
  ...overrides,
})

const app = { clientId: 'client', clientSecret: 'secret' }
const NOW = new Date('2026-09-08T12:00:00Z')

interface PageOptions {
  readonly next?: string
  readonly headers?: Record<string, string>
  readonly status?: number
}

function collection(rows: unknown[], options: PageOptions = {}): Response {
  const body =
    options.next === undefined
      ? { d: { results: rows } }
      : { d: { results: rows, __next: options.next } }

  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
}

/** The pair Exact hands back on a refresh. Fresh each call: a body reads once. */
const refreshed = (): Response =>
  new Response(
    JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 600 }),
    { status: 200 },
  )

function client(
  fetch: ReturnType<typeof vi.fn>,
  overrides: {
    readonly onTokens?: (next: ExactTokens) => Promise<void>
    readonly tokens?: ExactTokens
    readonly sleep?: (ms: number) => Promise<void>
    readonly now?: () => Date
  } = {},
) {
  return createExactClient({
    app,
    tokens: overrides.tokens ?? tokens(),
    onTokens: overrides.onTokens ?? (() => Promise.resolve()),
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: overrides.now ?? (() => NOW),
    sleep: overrides.sleep ?? (() => Promise.resolve()),
  })
}

describe('the URL it builds', () => {
  it('scopes the path to the division and names the columns', async () => {
    // Exact returns all two-hundred-odd columns of crm/Accounts otherwise.
    const fetch = vi.fn().mockResolvedValue(collection([]))
    await client(fetch).page({
      division: 3196493,
      path: 'crm/Accounts',
      select: ['ID', 'Name'],
      filter: 'IsSupplier eq true',
      top: 100,
    })

    const [url] = fetch.mock.calls[0] as [string]
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/api/v1/3196493/crm/Accounts')
    expect(parsed.searchParams.get('$select')).toBe('ID,Name')
    expect(parsed.searchParams.get('$filter')).toBe('IsSupplier eq true')
    expect(parsed.searchParams.get('$top')).toBe('100')
  })

  it('sends the bearer token and asks for JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(collection([]))
    await client(fetch).page({ division: 1, path: 'financial/GLAccounts', select: ['ID'] })

    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer access-1')
    expect(headers['accept']).toBe('application/json')
  })
})

describe('the shapes Exact answers in', () => {
  it('reads a collection with a __next', async () => {
    const fetch = vi.fn().mockResolvedValue(
      collection([{ Code: '1000' }], {
        next: 'https://start.exactonline.nl/api/v1/1/financial/GLAccounts?$skiptoken=x',
      }),
    )

    const page = await client(fetch).page({
      division: 1,
      path: 'financial/GLAccounts',
      select: ['Code'],
    })
    expect(page.rows).toHaveLength(1)
    expect(page.next).toContain('$skiptoken')
  })

  it('reads a bare array, which some endpoints answer with', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ d: [{ Code: '1000' }] }), { status: 200 }))

    const page = await client(fetch).page({ division: 1, path: 'x', select: ['Code'] })
    expect(page.rows).toEqual([{ Code: '1000' }])
  })

  it('reads a single entity as one row, so callers need no second path', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ d: { CurrentDivision: 42 } }), { status: 200 }),
      )

    const page = await client(fetch).page({ division: 1, path: 'x', select: ['CurrentDivision'] })
    expect(page.rows).toEqual([{ CurrentDivision: 42 }])
  })
})

describe('paging', () => {
  it('follows every __next rather than trusting one page', async () => {
    const second = 'https://start.exactonline.nl/api/v1/1/financial/GLAccounts?$skiptoken=2'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(collection([{ Code: '1000' }], { next: second }))
      .mockResolvedValueOnce(collection([{ Code: '1100' }]))

    const rows = await collectAll(client(fetch), {
      division: 1,
      path: 'financial/GLAccounts',
      select: ['Code'],
    })

    expect(rows).toEqual([{ Code: '1000' }, { Code: '1100' }])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[0]).toBe(second)
  })
})

describe('the refresh token', () => {
  it('stores the new pair before using it', async () => {
    // Exact kills the old refresh token the instant it issues a new one. A
    // process that dies between getting the pair and storing it has thrown the
    // connection away, so the order matters.
    const order: string[] = []

    const fetch = vi.fn((url: string) => {
      if (url.includes('/api/oauth2/token')) {
        order.push('refresh')
        return Promise.resolve(refreshed())
      }
      order.push(`request:${fetch.mock.calls.length.toString()}`)
      return Promise.resolve(collection([]))
    })

    await client(fetch, {
      tokens: tokens({ expiresAt: '2026-09-08T11:00:00.000Z' }),
      onTokens: () => {
        order.push('stored')
        return Promise.resolve()
      },
    }).page({ division: 1, path: 'x', select: ['a'] })

    expect(order).toEqual(['refresh', 'stored', 'request:2'])
  })

  it('uses the new access token for the request that triggered the refresh', async () => {
    const sent: string[] = []
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get('authorization') ?? '')
      return Promise.resolve(url.includes('/api/oauth2/token') ? refreshed() : collection([]))
    })

    await client(fetch, { tokens: tokens({ expiresAt: '2026-09-08T11:00:00.000Z' }) }).page({
      division: 1,
      path: 'x',
      select: ['a'],
    })

    // The refresh carries no bearer; the request after it carries the new one.
    expect(sent[1]).toBe('Bearer access-2')
  })

  it('refreshes once for several requests that all find it expired', async () => {
    // Each of them spending the refresh token would leave one winner and a
    // dead connection.
    let refreshes = 0
    const fetch = vi.fn((url: string) => {
      if (!url.includes('/api/oauth2/token')) return Promise.resolve(collection([]))
      refreshes += 1
      return Promise.resolve(refreshed())
    })

    const exact = client(fetch, { tokens: tokens({ expiresAt: '2026-09-08T11:00:00.000Z' }) })
    await Promise.all([
      exact.page({ division: 1, path: 'a', select: ['x'] }),
      exact.page({ division: 1, path: 'b', select: ['x'] }),
      exact.page({ division: 1, path: 'c', select: ['x'] }),
    ])

    expect(refreshes).toBe(1)
  })

  it('refreshes and retries once on a 401, then gives up', async () => {
    // A token can die before its own expires_in says, when somebody revokes
    // the app. One retry; a loop would hammer Exact.
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('/api/oauth2/token')
          ? refreshed()
          : new Response('unauthorised', { status: 401 }),
      ),
    )

    await expect(client(fetch).page({ division: 1, path: 'x', select: ['a'] })).rejects.toThrow(
      ExactApiError,
    )

    const tokenCalls = fetch.mock.calls.filter(([url]) => url.includes('oauth2/token'))
    expect(tokenCalls).toHaveLength(1)
  })
})

describe('rate limits', () => {
  it('waits for the window Exact named rather than backing off blindly', async () => {
    const slept: number[] = []
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        collection([], {
          status: 429,
          headers: {
            'X-RateLimit-Minutely-Remaining': '0',
            'X-RateLimit-Minutely-Reset': String(NOW.getTime() + 30_000),
          },
        }),
      )
      .mockResolvedValueOnce(collection([{ Code: '1000' }]))

    const page = await client(fetch, { sleep: (ms) => Promise.resolve(void slept.push(ms)) }).page({
      division: 1,
      path: 'x',
      select: ['Code'],
    })

    expect(page.rows).toHaveLength(1)
    // Thirty seconds plus a second of slack, because the reset instant and our
    // clock are not the same clock.
    expect(slept).toEqual([31_000])
  })

  it('waits before the next request when the minute is nearly spent', async () => {
    // Getting throttled on a five-thousand-row import wastes the whole minute,
    // and the header said so in advance.
    const slept: number[] = []
    // A fresh Response each call: a body can only be read once.
    const fetch = vi.fn(() =>
      collection([], {
        headers: {
          'X-RateLimit-Minutely-Remaining': '1',
          'X-RateLimit-Minutely-Reset': String(NOW.getTime() + 10_000),
        },
      }),
    )

    const exact = client(fetch, { sleep: (ms) => Promise.resolve(void slept.push(ms)) })
    await exact.page({ division: 1, path: 'a', select: ['x'] })
    expect(slept).toEqual([])

    await exact.page({ division: 1, path: 'b', select: ['x'] })
    expect(slept).toEqual([11_000])
  })

  it('refuses to wait out a reset that is hours away', async () => {
    const fetch = vi.fn().mockResolvedValue(
      collection([], {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(NOW.getTime() + 6 * 3_600_000),
        },
      }),
    )

    await expect(client(fetch).page({ division: 1, path: 'x', select: ['a'] })).rejects.toThrow(
      /too far off/,
    )
  })

  it('reports the budget so a screen can show it', async () => {
    const fetch = vi.fn().mockResolvedValue(
      collection([], {
        headers: {
          'X-RateLimit-Remaining': '4998',
          'X-RateLimit-Reset': String(NOW.getTime() + 3_600_000),
          'X-RateLimit-Minutely-Remaining': '58',
        },
      }),
    )

    const exact = client(fetch)
    await exact.page({ division: 1, path: 'x', select: ['a'] })

    expect(exact.rateLimit()).toMatchObject({ dailyRemaining: 4998, minutelyRemaining: 58 })
  })
})

describe('failures', () => {
  it('keeps Exact’s error body whole', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":{"message":{"value":"No such resource"}}}', { status: 404 }),
      )

    await expect(
      client(fetch).page({ division: 1, path: 'financial/Nope', select: ['a'] }),
    ).rejects.toThrow('No such resource')
  })

  it('does not throw a transport error as if Exact had answered', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const failure = await client(fetch)
      .page({ division: 1, path: 'x', select: ['a'] })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ExactApiError)
    expect((failure as ExactApiError).status).toBe(0)
  })

  it('stops after its request budget rather than running indefinitely', async () => {
    const fetch = vi.fn(() =>
      collection([{ Code: '1000' }], {
        next: 'https://start.exactonline.nl/api/v1/1/x?$skiptoken=loop',
      }),
    )

    const exact = createExactClient({
      app,
      tokens: tokens(),
      onTokens: () => Promise.resolve(),
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => NOW,
      maxRequests: 5,
    })

    // An endpoint whose __next never terminates. Without a budget this is an
    // infinite loop against somebody else's API.
    await expect(collectAll(exact, { division: 1, path: 'x', select: ['Code'] })).rejects.toThrow(
      /Stopping rather than continuing/,
    )
  })
})

describe('what it records', () => {
  it('logs every request with its status, duration and row count', async () => {
    // Spec 8, rule 3: every adapter records every request and response.
    const fetch = vi.fn().mockResolvedValue(collection([{ a: 1 }, { a: 2 }]))
    const exact = client(fetch)
    await exact.page({ division: 1, path: 'crm/Accounts', select: ['a'] })

    expect(exact.log).toEqual([
      { method: 'GET', path: 'crm/Accounts', status: 200, durationMs: 0, rows: 2 },
    ])
  })

  it('logs a failure too, so a broken import says what it asked', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    const exact = client(fetch)
    await exact.page({ division: 1, path: 'crm/Accounts', select: ['a'] }).catch(() => undefined)

    expect(exact.log[0]).toMatchObject({ status: 500, rows: 0 })
  })
})

describe('divisions', () => {
  it('asks Me for a division it may use, then asks that division for all of them', async () => {
    // system/Divisions is itself division-scoped, so there is a chicken and egg
    // here: the answer is the current division from Me.
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('current/Me')
          ? collection([
              {
                UserID: '00000000-0000-4000-8000-000000000000',
                FullName: 'H',
                CurrentDivision: 3196493,
              },
            ])
          : collection([
              { Code: 3196493, Description: 'Voorbeeld BV', Status: 1 },
              { Code: 3196494, Description: 'Voorbeeld Test', Status: 1, IsPracticeDivision: true },
            ]),
      ),
    )

    const divisions = await client(fetch).divisions()

    expect(fetch.mock.calls[1]?.[0]).toContain('/api/v1/3196493/system/Divisions')
    expect(divisions.map((division) => division.code)).toEqual([3196493, 3196494])
    expect(divisions[1]?.isPracticeDivision).toBe(true)
  })
})

describe('reading a division whose rights are uneven', () => {
  /**
   * The failure a real connection produced.
   *
   * `financial/ReportingBalance` answered 403 while `vat/VATCodes` — documented
   * under the same "Financial accounting" scope — answered 200. Exact grants
   * rights per resource, so there is no scope to fix and no retry that helps:
   * it is the signed-in user's rights on that administration.
   *
   * What the read pass must not do is throw away the seven resources that
   * answered because the eighth did not.
   */
  const division = {
    code: 1000,
    description: 'Test BV',
    currency: 'EUR',
    country: 'NL',
    vatNumber: null,
    chamberOfCommerceNumber: null,
    status: 1,
    isMainDivision: true,
    isPracticeDivision: false,
    isDossierDivision: false,
    archiveDate: null,
    current: true,
  }

  const forbidden = (): Response =>
    new Response(
      JSON.stringify({ error: { code: '', message: { lang: '', value: 'Forbidden' } } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )

  /** Answer 403 for one path and an empty collection for every other. */
  function refusing(path: string) {
    return vi.fn((input: string) =>
      Promise.resolve(String(input).includes(path) ? forbidden() : collection([])),
    )
  }

  it('asks Exact why, and only when it was a 403', async () => {
    /**
     * `users/UserHasRights` is Exact's own answer to "may this user read this
     * endpoint". Their 403 body says `Forbidden` and nothing else, so without
     * asking, the report can only list the four things it might be.
     *
     * Not asked on a 404: that is not a rights question, and the probe costs a
     * request against a finite daily budget.
     */
    const answering = (status: number) =>
      vi.fn((input: string) => {
        const url = String(input)
        if (url.includes('UserHasRights')) {
          return Promise.resolve(
            new Response(JSON.stringify({ d: false }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }
        if (url.includes('ReportingBalance')) {
          return Promise.resolve(new Response('{}', { status }))
        }
        return Promise.resolve(collection([]))
      })

    const forbidden = answering(403)
    const refusedSnapshot = await readDivision({
      client: client(forbidden),
      division,
      year: 2026,
    })

    expect(forbidden.mock.calls.some(([url]) => String(url).includes('UserHasRights'))).toBe(true)
    // `{"d": false}` is a bare scalar, which the unwrapper used to drop — so
    // "no" arrived as "no answer" and the report hedged.
    expect(refusedSnapshot.unreadable[0]?.userHasRight).toBe(false)

    const gone = answering(404)
    const missingSnapshot = await readDivision({ client: client(gone), division, year: 2026 })

    expect(gone.mock.calls.some(([url]) => String(url).includes('UserHasRights'))).toBe(false)
    expect(missingSnapshot.unreadable[0]?.userHasRight).toBeNull()
  })

  it('treats an unanswerable probe as unknown rather than as a refusal', async () => {
    // The probe is scoped `Organization administration`. A login refused the
    // resource can be refused the question about it, and reporting that as
    // "this user lacks the right" would send somebody to fix the wrong thing.
    const fetch = vi.fn((input: string) => {
      const url = String(input)
      if (url.includes('UserHasRights')) return Promise.resolve(forbidden())
      if (url.includes('ReportingBalance')) return Promise.resolve(forbidden())
      return Promise.resolve(collection([]))
    })

    const snapshot = await readDivision({ client: client(fetch), division, year: 2026 })

    expect(snapshot.unreadable[0]?.userHasRight).toBeNull()
  })

  it('records the refusal and keeps reading', async () => {
    const fetch = refusing('ReportingBalance')

    const snapshot = await readDivision({
      client: client(fetch),
      division,
      year: 2026,
    })

    expect(snapshot.unreadable).toEqual([
      expect.objectContaining({ resource: 'financial/ReportingBalance', status: 403 }),
    ])
    // `null`, not `[]`: the planner has to be able to tell an unread year from
    // an empty one, because an empty one balances.
    expect(snapshot.trialBalance).toBeNull()

    // Every other resource was still asked for. Seven reads, one of them refused.
    const asked = fetch.mock.calls.map(([url]) => String(url))
    expect(asked.some((url) => url.includes('bulk/CRM/Accounts'))).toBe(true)
    expect(asked.some((url) => url.includes('ReceivablesList'))).toBe(true)
    expect(asked.some((url) => url.includes('PayablesList'))).toBe(true)
  })

  it('reads a clean division with no refusals at all', async () => {
    const fetch = vi.fn(() => Promise.resolve(collection([])))

    const snapshot = await readDivision({ client: client(fetch), division, year: 2026 })

    expect(snapshot.unreadable).toEqual([])
    // Read and empty, which is a different fact from not read.
    expect(snapshot.trialBalance).toEqual([])
  })

  it('lets a transport failure through, because it is not a fact about rights', async () => {
    // Swallowing this would turn "the network went away" into "this division
    // has no customers", and the import would proceed on it.
    const fetch = vi.fn((input: string) =>
      String(input).includes('bulk/CRM/Accounts')
        ? Promise.reject(new Error('socket hang up'))
        : Promise.resolve(collection([])),
    )

    await expect(readDivision({ client: client(fetch), division, year: 2026 })).rejects.toThrow(
      'socket hang up',
    )
  })
})

describe('which failures a single resource may degrade over', () => {
  const division = {
    code: 1000,
    description: 'Test BV',
    currency: 'EUR',
    country: 'NL',
    vatNumber: null,
    chamberOfCommerceNumber: null,
    status: 1,
    isMainDivision: true,
    isPracticeDivision: false,
    isDossierDivision: false,
    archiveDate: null,
    current: true,
  }

  const answering = (path: string, status: number) =>
    vi.fn((input: string) =>
      Promise.resolve(
        String(input).includes(path)
          ? new Response(JSON.stringify({ error: 'no' }), { status })
          : collection([]),
      ),
    )

  // 404 is "this division has not got that module", which the rest survives.
  it.each([403, 404])('degrades over %i', async (status) => {
    const snapshot = await readDivision({
      client: client(answering('vat/VATCodes', status)),
      division,
      year: 2026,
    })

    expect(snapshot.unreadable).toEqual([
      expect.objectContaining({ resource: 'vat/VATCodes', status }),
    ])
  })

  /**
   * 400 is our query being wrong and 500 is Exact being broken. Degrading over
   * either would import an administration with a resource silently missing and
   * call it a success — which is the failure mode this whole shape exists to
   * avoid, pointed the other way.
   */
  it.each([400, 500, 503])('refuses to degrade over %i', async (status) => {
    await expect(
      readDivision({ client: client(answering('vat/VATCodes', status)), division, year: 2026 }),
    ).rejects.toThrow(ExactApiError)
  })
})

describe('how many requests a read costs', () => {
  const division = {
    code: 1000,
    description: 'Test BV',
    currency: 'EUR',
    country: 'NL',
    vatNumber: null,
    chamberOfCommerceNumber: null,
    status: 1,
    isMainDivision: true,
    isPracticeDivision: false,
    isDossierDivision: false,
    archiveDate: null,
    current: true,
  }

  /**
   * Exact's ordinary collections page at sixty rows; the `bulk/` variants of
   * the same resources page at a thousand. On an administration with thousands
   * of relations that is the difference between six requests and eighty-four,
   * and between a read that finishes and one that outlives the timeout in front
   * of it.
   */
  it('asks the bulk endpoints for the resources that have one', async () => {
    const fetch = vi.fn((_input: string) => Promise.resolve(collection([])))

    await readDivision({ client: client(fetch), division, year: 2026, documents: true })

    const asked = fetch.mock.calls.map(([url]) => String(url))
    expect(asked.some((url) => url.includes('/bulk/CRM/Accounts'))).toBe(true)
    expect(asked.some((url) => url.includes('/bulk/Financial/GLAccounts'))).toBe(true)

    // And not the sixty-row versions of the same things.
    expect(asked.some((url) => url.includes('/crm/Accounts'))).toBe(false)
    expect(asked.some((url) => url.includes('/financial/GLAccounts'))).toBe(false)
  })

  it('leaves the resources with no bulk variant alone', async () => {
    const fetch = vi.fn((_input: string) => Promise.resolve(collection([])))

    await readDivision({ client: client(fetch), division, year: 2026 })

    const asked = fetch.mock.calls.map(([url]) => String(url))
    // These four have no `bulk/` form, and two of them are already Exact's own
    // pre-aggregated "read" endpoints.
    expect(asked.some((url) => url.includes('/vat/VATCodes'))).toBe(true)
    expect(asked.some((url) => url.includes('/cashflow/PaymentConditions'))).toBe(true)
    expect(asked.some((url) => url.includes('/financial/ReportingBalance'))).toBe(true)
    expect(asked.some((url) => url.includes('/read/financial/ReceivablesList'))).toBe(true)
  })

  it('stops paging documents once it has the limit', async () => {
    /**
     * A division with a long document history used to be read in full and then
     * sliced. Fifty pages fetched to keep one of them, and fifty requests off
     * the daily budget to answer a question that needed one.
     */
    const page = (n: number) =>
      collection(
        Array.from({ length: 1000 }, (_, index) => ({
          ID: `00000000-0000-0000-0000-${String(n * 1000 + index).padStart(12, '0')}`,
          Subject: 'Bon',
        })),
        {
          next: `https://start.exactonline.nl/api/v1/1000/bulk/Documents/Documents?$skiptoken=${String(n + 1)}`,
        },
      )

    let documentPages = 0
    const fetch = vi.fn((input: string) => {
      if (String(input).includes('bulk/Documents/Documents')) {
        documentPages += 1
        return Promise.resolve(page(documentPages))
      }
      return Promise.resolve(collection([]))
    })

    await readDivision({
      client: client(fetch),
      division,
      year: 2026,
      documents: true,
      documentLimit: 500,
    })

    // One page of a thousand already covers a limit of five hundred. A second
    // would be a request whose every row is thrown away.
    expect(documentPages).toBe(1)
  })
})
