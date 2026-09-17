import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { KLOPT_VERSION } from '@klopt/core'
import { ApiError, ApiClient } from './client.js'
import { ToolContext } from './context.js'
import { describeSchema, describeSchemaInput } from './tools/schema.js'
import { getBalance, getBalanceInput } from './tools/balance.js'
import { listOpenItems, listOpenItemsInput } from './tools/open-items.js'
import { vatReturnPreview, vatReturnPreviewInput } from './tools/vat.js'
import { listPendingApprovals, listPendingApprovalsInput } from './tools/approvals.js'
import { explainNumber, explainNumberInput } from './tools/explain.js'
import { search, searchInput } from './tools/search.js'
import { exportXaf, exportXafInput } from './tools/export.js'
import {
  capturePurchaseInvoice,
  capturePurchaseInvoiceInput,
  checkJournalEntry,
  checkJournalEntryInput,
  draftFromInboxItem,
  draftFromInboxItemInput,
  draftSalesInvoice,
  draftSalesInvoiceInput,
} from './tools/propose.js'

/**
 * Klopt's MCP server (spec 10.3).
 *
 * ## Read is broad, write is narrow
 *
 * "Never expose a generic query or SQL tool. Every write tool is a named domain
 * operation with a typed argument set." Eight read tools, each one a named
 * question a bookkeeper actually asks, and four write tools, each one a named
 * thing an agent may propose. There is no `query`, no `sql`, no `call_endpoint`
 * escape hatch, and adding one later would undo the entire safety model in a
 * single commit — which is why the absence is written down here rather than
 * left as an observation about the current file.
 *
 * ## An agent drafts; a human releases
 *
 * Every write tool ends at something that exists and has not happened yet: a
 * draft invoice with no number, a purchase invoice that is not booked, an entry
 * that was validated and deliberately not posted.
 *
 * There is no `issue_invoice`, no `book_purchase_invoice`, no `send_invoice`
 * and no `post_journal_entry`, and their absence is the design. Those are the
 * release — the moment somebody becomes answerable for a number to a customer,
 * a supplier or the Belastingdienst. An agent that can draft *and* release can
 * do the whole thing, and then the proposal model is a description of a habit
 * rather than a property of the system.
 *
 * ## The two that took a REST route first
 *
 * `search` and `explain_number` are the tools the spec names that this server
 * went without the longest, because neither had an endpoint. The tempting
 * shortcut was to build them *here*, fanning out across list endpoints and
 * filtering in this process — which would have broken the rule this server
 * exists under: "the MCP server is a client of the public API, not a
 * privileged path". A capability an agent has and a script cannot get is
 * exactly the second path the rule forbids. So `GET /api/v1/search` and
 * `GET /api/v1/explain` were built first, and these two are thin over them.
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
              // Which fields, and why. "The query string is not valid" on its
              // own is a sentence an agent can only respond to by guessing.
              violations: error.violations.length === 0 ? undefined : error.violations,
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

  const server = new McpServer({ name: 'klopt', version: KLOPT_VERSION })

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

  /**
   * A write that creates something reversible and unreleased.
   *
   * `destructiveHint: false` is accurate rather than reassuring: nothing here
   * overwrites or removes anything. `idempotentHint: false` is the honest one —
   * calling `draft_sales_invoice` twice makes two drafts, and a client that
   * assumed otherwise would retry a timeout into a duplicate.
   */
  const proposes = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  }

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
    'search',
    {
      description:
        'Find contacts, sales invoices, purchase invoices, journal entries and documents by a word or a number. Returns ids and a drill-down route for each hit. Use this when you have a name or a reference rather than an id; do not answer from the titles it returns.',
      inputSchema: searchInput.shape,
      annotations: readOnly,
    },
    guard((args) => search(context, args)),
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
    'explain_number',
    {
      description:
        'The lines behind a reported figure — a BTW-rubriek, an account line on a statement, an ageing bucket — and whether they add up to it. Read `ties` before quoting anything: false means the evidence does not account for the figure, which is a finding, not a detail.',
      inputSchema: explainNumberInput.shape,
      annotations: readOnly,
    },
    guard((args) => explainNumber(context, args)),
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

  server.registerTool(
    'check_journal_entry',
    {
      description:
        'Validate a journal entry and post nothing: whether it balances, which period the date falls in, and whether that period is open. Use before asking a human to post. There is no tool that posts — the journal is append-only, so posting would be the release rather than a proposal.',
      inputSchema: checkJournalEntryInput.shape,
      annotations: readOnly,
    },
    guard((args) => checkJournalEntry(context, args)),
  )

  server.registerTool(
    'draft_sales_invoice',
    {
      description:
        'Create a draft sales invoice. It gets no number and no journal entry until a human issues it, so this cannot consume one from the gapless series.',
      inputSchema: draftSalesInvoiceInput.shape,
      annotations: proposes,
    },
    guard((args) => draftSalesInvoice(context, args)),
  )

  server.registerTool(
    'capture_purchase_invoice',
    {
      description:
        "Capture a supplier's invoice as a draft, with their stated totals as given. It is not booked, so it is not yet a liability and its VAT is not yet deductible — a human does that.",
      inputSchema: capturePurchaseInvoiceInput.shape,
      annotations: proposes,
    },
    guard((args) => capturePurchaseInvoice(context, args)),
  )

  server.registerTool(
    'draft_from_inbox_item',
    {
      description:
        'Turn a document that arrived in the Postvak into a draft purchase invoice, with the document still attached to it. Not booked.',
      inputSchema: draftFromInboxItemInput.shape,
      annotations: proposes,
    },
    guard((args) => draftFromInboxItem(context, args)),
  )

  return server
}
