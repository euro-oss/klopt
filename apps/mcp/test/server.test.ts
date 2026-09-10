import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from '../src/server.js'

/**
 * The safety model, tested as a property of the server rather than trusted as
 * a description of it (spec 10.3).
 *
 * "Read is broad, write is narrow. Never expose a generic query or SQL tool."
 * That is a claim which stops being true the first time somebody adds a
 * convenience tool, and the whole design rests on it — so it is asserted here,
 * where adding one fails the build.
 */

const ENTITY = {
  id: '01a07c20-d6ab-7237-ae27-ae4def86811f',
  name: 'Neverhide',
  functionalCurrency: 'EUR',
}

/** A stand-in Klopt API. The MCP server only ever reaches it over HTTP. */
function api(routes: Record<string, unknown>, status = 200) {
  return vi.fn((input: string | URL | Request) => {
    // `Request` stringifies to `[object Object]`, so read its url properly —
    // the stub has to be as honest about the fetch contract as the real thing.
    const href = input instanceof Request ? input.url : input.toString()
    const path = new URL(href).pathname.replace('/api/v1', '')
    const body = routes[path]
    if (body === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'not_found', detail: `No ${path}` }), { status: 404 }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
}

type StubFetch = (input: string | URL | Request) => Promise<Response>

async function connect(fetch: StubFetch) {
  const server = createServer({ baseUrl: 'https://books.example.org', token: 'tok', fetch })
  const client = new Client({ name: 'test', version: '0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return client
}

const CHART = {
  '/entity': ENTITY,
  '/accounts': {
    accounts: [
      {
        number: '1300',
        name: 'Debiteuren',
        type: 'asset',
        normalBalance: 'debit',
        rgsCode: 'BVorDeb',
        isBlocked: false,
        defaultTaxCode: null,
      },
      {
        number: '9998',
        name: 'Oud',
        type: 'expense',
        normalBalance: 'debit',
        rgsCode: null,
        isBlocked: true,
        defaultTaxCode: null,
      },
    ],
  },
  '/journals': { journals: [{ code: 'MEM', name: 'Memoriaal', type: 'memoriaal' }] },
  '/tax-codes': { taxCodes: [{ code: 'H', description: 'Hoog' }] },
  '/fiscal-years': {
    fiscalYears: [{ code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'open' }],
  },
}

describe('what an agent is allowed to reach for', () => {
  let fetch: ReturnType<typeof api>

  beforeEach(() => {
    fetch = api(CHART)
  })

  it('offers only named domain questions, and no way out of them', async () => {
    const client = await connect(fetch)
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name).sort()

    expect(names).toEqual([
      'capture_purchase_invoice',
      'check_journal_entry',
      'describe_schema',
      'draft_from_inbox_item',
      'draft_sales_invoice',
      'export_xaf',
      'get_balance',
      'list_open_items',
      'list_pending_approvals',
      'vat_return_preview',
    ])

    // The escape hatch that would undo the whole model in one commit.
    for (const forbidden of ['query', 'sql', 'call', 'request', 'fetch', 'execute', 'raw']) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false)
    }
  })

  it('annotates the writes as writes, and nothing as destructive', async () => {
    /**
     * This used to assert every tool was read-only, which stopped being true
     * when the proposal tools arrived. The property worth keeping is not "no
     * writes" — it is that a write says so, and that nothing here destroys
     * anything.
     */
    const client = await connect(fetch)
    const { tools } = await client.listTools()

    const writes = new Set([
      'draft_sales_invoice',
      'capture_purchase_invoice',
      'draft_from_inbox_item',
    ])

    for (const tool of tools) {
      expect(tool.annotations?.destructiveHint).toBe(false)
      expect(tool.annotations?.readOnlyHint).toBe(!writes.has(tool.name))
    }

    // Drafting twice makes two drafts. A client that assumed otherwise would
    // retry a timeout into a duplicate invoice.
    for (const name of writes) {
      const tool = tools.find((candidate) => candidate.name === name)
      expect(tool?.annotations?.idempotentHint).toBe(false)
    }
  })

  it('exposes nothing that files, sends, issues or pays', async () => {
    /**
     * The release, which stays human. An agent may draft an invoice; issuing it
     * allocates a number from a series the law requires to be gapless and makes
     * it a document somebody is answerable for. Same for booking a purchase
     * invoice (a liability, and a VAT claim), filing a return, and releasing a
     * payment batch.
     *
     * `post` is not on this list only because `check_journal_entry` contains
     * it; the assertion below covers what matters, which is that nothing
     * actually posts.
     */
    const client = await connect(fetch)
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name).join(' ')

    for (const verb of ['file', 'send', 'issue', 'pay', 'approve', 'delete', 'seal', 'book']) {
      expect(names).not.toContain(verb)
    }
  })

  it('validates a journal entry without posting it', async () => {
    // The journal is append-only and hash-chained, so there is no draft state
    // to release from — an agent posting to it would *be* the release. The tool
    // therefore forces `dryRun`, and the test is that it cannot be turned off.
    const posts: { path: string; body: unknown }[] = []
    const recording = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const href = input instanceof Request ? input.url : input.toString()
      if ((init?.method ?? 'GET') === 'POST') {
        const sent = typeof init?.body === 'string' ? init.body : '{}'
        posts.push({ path: href, body: JSON.parse(sent) })
        return Promise.resolve(
          new Response(JSON.stringify({ balanced: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      return fetch(input)
    })

    const client = await connect(recording)
    await client.callTool({
      name: 'check_journal_entry',
      arguments: {
        journalCode: 'MEM',
        bookingDate: '2026-09-10',
        documentDate: '2026-09-10',
        description: 'Test',
        lines: [
          { accountNumber: '1300', debit: '100.00', credit: '0' },
          { accountNumber: '8000', debit: '0', credit: '100.00' },
        ],
      },
    })

    expect(posts).toHaveLength(1)
    expect(posts[0]?.path).toContain('/journal-entries')
    expect((posts[0]?.body as { dryRun: boolean }).dryRun).toBe(true)
  })
})

describe('what comes back with an answer', () => {
  it('never answers without saying whose books, in what currency, from where', async () => {
    const client = await connect(api(CHART))
    const result = await client.callTool({
      name: 'describe_schema',
      arguments: { include: ['journals'] },
    })

    const payload = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      provenance: Record<string, unknown>
    }

    expect(payload.provenance).toMatchObject({
      entity: { id: ENTITY.id, name: 'Neverhide' },
      currency: 'EUR',
      amounts: { unit: 'decimal' },
    })
    // The routes behind it, so the same question can be asked without this
    // server — and so a human can check the agent's homework.
    expect(payload.provenance['sources']).toContain('/api/v1/journals')
    expect(typeof payload.provenance['readAt']).toBe('string')
  })

  it('hides blocked accounts by default and says how many are usable', async () => {
    const client = await connect(api(CHART))
    const result = await client.callTool({
      name: 'describe_schema',
      arguments: { include: ['accounts'] },
    })
    const payload = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      data: { accounts: { number: string }[]; accountCount: number }
    }

    expect(payload.data.accounts.map((a) => a.number)).toEqual(['1300'])
    expect(payload.data.accountCount).toBe(1)
  })
})

describe('when the API says no', () => {
  it('turns a refusal into something the agent can act on', async () => {
    // A tool that throws tells an agent only that something went wrong. A 403
    // means "your token lacks a permission", which is a different next move
    // from "that does not exist".
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'forbidden', detail: 'This token does not have x.' }), {
          status: 403,
        }),
      ),
    )
    const client = await connect(fetch)
    const result = await client.callTool({ name: 'describe_schema', arguments: {} })

    expect(result.isError).toBe(true)
    const payload = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      status: number
      hint: string
    }
    expect(payload.status).toBe(403)
    expect(payload.hint).toContain('read-only unless deliberately widened')
  })

  it('says so plainly when Klopt is not running', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    const client = await connect(fetch)
    const result = await client.callTool({ name: 'describe_schema', arguments: {} })

    expect(result.isError).toBe(true)
    expect((result.content as { text: string }[])[0]!.text).toContain('not reachable')
  })
})
