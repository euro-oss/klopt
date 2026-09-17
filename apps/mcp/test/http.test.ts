import { describe, expect, it, vi } from 'vitest'
import { handleMcpRequest } from '../src/http.js'

/**
 * The remote transport (spec 10.3: "streamable HTTP for remote").
 *
 * stdio only works when the agent and the books share a machine. For anybody
 * running Klopt as a hosted service that is the half a customer cannot use, so
 * these tests are about the half they can.
 */

const ENTITY = { id: 'e1', name: 'Neverhide', functionalCurrency: 'EUR' }

const api = vi.fn((input: string | URL | Request) => {
  const href = input instanceof Request ? input.url : input.toString()
  if (href.includes('/entity')) {
    return Promise.resolve(
      new Response(JSON.stringify(ENTITY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return Promise.resolve(
    new Response(JSON.stringify({ journals: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
})

const post = (body: unknown): Promise<Response> =>
  handleMcpRequest(
    new Request('https://books.example.org/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { baseUrl: 'https://books.example.org', token: 'tok', fetch: api },
  )

describe('one JSON-RPC message per request', () => {
  it('answers initialize', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'c', version: '0' },
      },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { serverInfo: { name: string } } }
    expect(body.result.serverInfo.name).toBe('klopt')
  })

  it('lists the tools on a server that was never initialised', async () => {
    // Statelessness in one assertion: every request builds a fresh server, so
    // none of them has seen an initialize. If that stopped working, the
    // endpoint would need sessions and sticky routing to be hosted at all.
    const response = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const body = (await response.json()) as { result: { tools: { name: string }[] } }

    expect(body.result.tools).toHaveLength(12)
  })

  it('returns 202 for a notification instead of hanging forever', async () => {
    /**
     * The bug this is here for. A notification has no reply, and the transport
     * waited for one anyway — so `initialize` succeeded, the client sent
     * `notifications/initialized`, and the connection hung until undici gave
     * up on headers that were never coming. Every hosted session would have
     * died at the handshake.
     *
     * The assertion is that this resolves at all; the status is a detail.
     */
    const response = await Promise.race([
      post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the notification never answered')), 2_000),
      ),
    ])

    expect(response.status).toBe(202)
  })

  it('calls a tool and carries the provenance through', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'describe_schema', arguments: { include: ['journals'] } },
    })

    const body = (await response.json()) as {
      result: { content: { text: string }[] }
    }
    const payload = JSON.parse(body.result.content[0]!.text) as {
      provenance: { entity: { name: string }; amounts: { unit: string } }
    }

    expect(payload.provenance.entity.name).toBe('Neverhide')
    expect(payload.provenance.amounts.unit).toBe('decimal')
  })
})

describe('what it refuses', () => {
  it('turns an unreadable body into a JSON-RPC parse error, not a crash', async () => {
    const response = await handleMcpRequest(
      new Request('https://books.example.org/api/mcp', { method: 'POST', body: 'not json' }),
      { baseUrl: 'https://books.example.org', token: 'tok', fetch: api },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32700)
  })

  it('says there is no SSE stream rather than leaving a client waiting on one', async () => {
    // The client does try a GET. A 405 is what the MCP spec says to answer when
    // there is nothing to stream, and the client carries on.
    const response = await handleMcpRequest(
      new Request('https://books.example.org/api/mcp', { method: 'GET' }),
      { baseUrl: 'https://books.example.org', token: 'tok', fetch: api },
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })
})
