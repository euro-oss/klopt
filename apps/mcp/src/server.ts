import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ApiError, ApiClient } from './client.js'
import { ToolContext } from './context.js'
import { describeSchema, describeSchemaInput } from './tools/schema.js'
import { getBalance, getBalanceInput } from './tools/balance.js'
import { listOpenItems, listOpenItemsInput } from './tools/open-items.js'
import { vatReturnPreview, vatReturnPreviewInput } from './tools/vat.js'
import { listPendingApprovals, listPendingApprovalsInput } from './tools/approvals.js'
import { exportXaf, exportXafInput } from './tools/export.js'

/**
 * Klopt's MCP server (spec 10.3).
 *
 * ## Read is broad, write is narrow — and today there is no write at all
 *
 * "Never expose a generic query or SQL tool. Every write tool is a named domain
 * operation with a typed argument set." Six read tools, each one a named
 * question a bookkeeper actually asks. There is no `query`, no `sql`, no
 * `call_endpoint` escape hatch, and adding one later would undo the entire
 * safety model in a single commit — which is why the absence is written down
 * here rather than left as an observation about the current file.
 *
 * The spec has the MCP server shipping read-only first and gaining write tools
 * behind the proposal model afterwards. This is that first half.
 *
 * ## Two tools the spec names and this does not have
 *
 * `search` and `explain_number` are missing on purpose. Both need REST
 * endpoints that do not exist yet — there is no cross-entity search, and no
 * route that takes a reported figure and returns the lines behind it.
 *
 * The tempting shortcut is to build them *here*, fanning out across list
 * endpoints and filtering in this process. That would break the rule this
 * server exists under: "the MCP server is a client of the public API, not a
 * privileged path". A capability an agent has and a script cannot get is
 * exactly the second path the rule forbids. They arrive when the endpoints do.
 */

export interface ServerOptions {
  readonly baseUrl: string
  readonly token: string
  readonly fetch?: typeof globalThis.fetch
}

/** What a tool answers with, in MCP's shape. */
function content(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

/**
 * An error an agent can act on.
 *
 * `isError` rather than a thrown exception, because a tool that throws tells
 * the agent only that something went wrong. A 403 means "your token does not
 * have this permission" and a 404 means "that does not exist here", and those
 * lead to different next moves.
 */
function failure(error: unknown) {
  if (error instanceof ApiError) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: error.message,
              status: error.status,
              code: error.code,
              path: error.path,
              hint:
                error.status === 401 || error.status === 403
                  ? 'The token is missing a permission this tool needs. Tokens are read-only unless deliberately widened.'
                  : undefined,
            },
            null,
            2,
          ),
        },
      ],
    }
  }
  return {
    isError: true,
    content: [
      { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
    ],
  }
}

export function createServer(options: ServerOptions): McpServer {
  const context = new ToolContext(
    new ApiClient({
      baseUrl: options.baseUrl,
      token: options.token,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
  )

  const server = new McpServer({ name: 'klopt', version: '0.0.0' })

  /**
   * Everything a tool can go wrong with, turned into something an agent can
   * read, plus the envelope MCP expects.
   *
   * Wrapped at the handler rather than at registration, so each tool keeps the
   * SDK's own inference from its Zod shape — a generic registration helper
   * erases the argument type and the tools stop being typed at all.
   */
  const guard =
    <TArgs>(run: (args: TArgs) => Promise<unknown>) =>
    async (args: TArgs) => {
      try {
        return content(await run(args))
      } catch (error: unknown) {
        return failure(error)
      }
    }

  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }

  server.registerTool(
    'describe_schema',
    {
      description:
        'The chart of accounts, dagboeken, tax codes and book years of this administration. Call this first: every other tool is phrased in terms of an account number or a code, and guessing at them is how an agent reports the wrong figure.',
      inputSchema: describeSchemaInput.shape,
      annotations: readOnly,
    },
    guard((args) => describeSchema(context, args)),
  )

  server.registerTool(
    'get_balance',
    {
      description:
        'Balances for a book year and period range, per account, with a drill-down path to the entries behind each one.',
      inputSchema: getBalanceInput.shape,
      annotations: readOnly,
    },
    guard((args) => getBalance(context, args)),
  )

  server.registerTool(
    'list_open_items',
    {
      description:
        'Outstanding debtors and creditors with ageing, and whether the creditor subledger ties to its control account.',
      inputSchema: listOpenItemsInput.shape,
      annotations: readOnly,
    },
    guard((args) => listOpenItems(context, args)),
  )

  server.registerTool(
    'vat_return_preview',
    {
      description:
        'The BTW-aangifte for a period as it currently stands, with its reconciliation. Read-only: filing is a human action and is not available to an agent.',
      inputSchema: vatReturnPreviewInput.shape,
      annotations: readOnly,
    },
    guard((args) => vatReturnPreview(context, args)),
  )

  server.registerTool(
    'list_pending_approvals',
    {
      description:
        'What is waiting for a human: purchase invoices booked but not approved, unfiled inbox documents, and open payment batches.',
      inputSchema: listPendingApprovalsInput.shape,
      annotations: readOnly,
    },
    guard((args) => listPendingApprovals(context, args)),
  )

  server.registerTool(
    'export_xaf',
    {
      description:
        'Check that a period-scoped XAF 3.2 auditfile can be produced and return a reference to it. The file itself is not returned — it is megabytes of XML.',
      inputSchema: exportXafInput.shape,
      annotations: readOnly,
    },
    guard((args) => exportXaf(context, args)),
  )

  return server
}
