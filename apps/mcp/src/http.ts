import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createServer } from './server.js'

/**
 * The MCP server over HTTP (spec 10.3: "stdio for local use, streamable HTTP
 * for remote").
 *
 * stdio is the half that only works if the agent and the books are on the same
 * machine. For anybody running Klopt as a hosted service, that is the useless
 * half — a customer would have to install a Node process locally and keep a
 * token in a config file. Over HTTP the endpoint is simply wherever Klopt
 * already is, with the same TLS and the same tokens as the REST API.
 *
 * ## Stateless, one message per request
 *
 * No sessions, no SSE stream, no server-initiated messages. Every request
 * carries one JSON-RPC message and gets one reply, which means any number of
 * instances can serve the same client with no sticky routing and nothing to
 * expire. The tools are all reads with no subscriptions or progress to report,
 * so there is nothing a session would carry.
 *
 * If a tool ever needs to stream, this is the thing that has to change, and it
 * should change deliberately rather than because a session store crept in.
 *
 * ## Web-native rather than Node-shaped
 *
 * The SDK's own HTTP transport wants Node's `req`/`res`. The web app speaks
 * `Request` and `Response`, and shimming one onto the other is a pile of
 * pretend streams. The `Transport` interface is four methods, so this
 * implements it directly: hand the message in, capture the reply, return it.
 */

/** One message in, one message out. */
class SingleMessageTransport implements Transport {
  private resolve: ((message: JSONRPCMessage | null) => void) | null = null
  private readonly replied: Promise<JSONRPCMessage | null>

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor() {
    this.replied = new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  start(): Promise<void> {
    return Promise.resolve()
  }

  send(message: JSONRPCMessage): Promise<void> {
    // The first reply is the reply. A notification produces none, which is
    // what `deliver`'s timeout-free `null` path is for.
    this.resolve?.(message)
    this.resolve = null
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.resolve?.(null)
    this.resolve = null
    this.onclose?.()
    return Promise.resolve()
  }

  /**
   * Feed one incoming message and wait for its answer.
   *
   * A notification has no answer — JSON-RPC defines it as a message with no
   * `id` — so waiting for one deadlocks the request until the client gives up.
   * That is exactly what happened: `initialize` returned, the client sent
   * `notifications/initialized`, and the connection hung until undici timed
   * out on headers that were never coming.
   */
  async deliver(message: JSONRPCMessage): Promise<JSONRPCMessage | null> {
    const expectsReply = 'id' in message && message.id !== undefined && message.id !== null

    this.onmessage?.(message)
    if (!expectsReply) return null
    return this.replied
  }
}

export interface HttpOptions {
  /** Where the REST API is. The MCP server calls it like any other client. */
  readonly baseUrl: string
  /** The caller's own token, forwarded unchanged. */
  readonly token: string
  readonly fetch?: typeof globalThis.fetch
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const

function rpcError(id: unknown, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }),
    { status: 200, headers: JSON_HEADERS },
  )
}

/**
 * Handle one MCP request.
 *
 * Returns a `Response` so it can be mounted by anything that speaks the web
 * platform — which is how it ends up inside the web app rather than needing a
 * second process and a second port to deploy.
 */
export async function handleMcpRequest(request: Request, options: HttpOptions): Promise<Response> {
  if (request.method !== 'POST') {
    // No GET: that is the SSE half of streamable HTTP, and there is no
    // server-initiated message to carry over it. Saying so beats an empty
    // stream that a client waits on.
    return new Response(
      JSON.stringify({
        error:
          'Only POST is supported. This endpoint is stateless: one JSON-RPC message per request, no SSE stream.',
      }),
      { status: 405, headers: { ...JSON_HEADERS, allow: 'POST' } },
    )
  }

  let message: JSONRPCMessage
  try {
    message = (await request.json()) as JSONRPCMessage
  } catch {
    return rpcError(null, -32700, 'Parse error: the body is not JSON.')
  }

  const server = createServer({
    baseUrl: options.baseUrl,
    token: options.token,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
  const transport = new SingleMessageTransport()

  try {
    await server.connect(transport)
    const reply = await transport.deliver(message)

    // A notification has no reply, and JSON-RPC says to answer nothing. 202
    // rather than an empty 200, so a client can tell the difference between
    // "accepted, nothing to say" and "here is an empty answer".
    if (reply === null) return new Response(null, { status: 202 })

    return new Response(JSON.stringify(reply), { status: 200, headers: JSON_HEADERS })
  } catch (error: unknown) {
    return rpcError(
      (message as { id?: unknown }).id,
      -32603,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    await server.close()
  }
}
