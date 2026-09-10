import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, minorUnitsFrom, type Answer } from '../provenance.js'

/**
 * The write tools (spec 10.3).
 *
 * "An agent drafts; a human releases." Every tool here ends at something that
 * exists in the books but has not happened yet: a draft invoice nobody has
 * issued, a purchase invoice nobody has booked, an entry that was checked and
 * deliberately not posted.
 *
 * ## What is missing from this file is the design
 *
 * There is no `issue_invoice`, no `book_purchase_invoice`, no `send_invoice`,
 * no `approve_payment_batch` and no `post_journal_entry`. Those are the
 * release, and the release is the point at which somebody becomes answerable
 * for a number — to a customer, to a supplier, to the Belastingdienst. An
 * agent that can both draft and release is an agent that can do the whole
 * thing, and then "an agent drafts" is a description of a habit rather than a
 * property of the system.
 *
 * The permissions enforce it as well as the tool list. A token granted through
 * OAuth carries `ledger:read` and `ledger:export` and nothing else, so these
 * tools need one issued deliberately in Toegang — which is itself a decision
 * somebody made about a specific agent.
 *
 * ## Every draft says how to release it
 *
 * A draft an agent cannot describe is a draft a human has to go and find. Each
 * answer carries the id, what it will do when released, and the screen it is
 * waiting on.
 */

// ---------------------------------------------------------------------------
// check_journal_entry
// ---------------------------------------------------------------------------

const lineInput = z.object({
  accountNumber: z.string().min(1).describe('From describe_schema.'),
  description: z.string().nullable().default(null),
  debit: z.string().default('0').describe('Decimal string, e.g. "1210.00". One side per line.'),
  credit: z.string().default('0'),
  taxCode: z.string().nullable().default(null),
  taxRole: z.enum(['base', 'tax']).nullable().default(null),
  taxAmount: z.string().nullable().default(null),
})

export const checkJournalEntryInput = z.object({
  journalCode: z.string().min(1).describe('A dagboek code from describe_schema, e.g. "MEM".'),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  lines: z.array(lineInput).min(2),
})

/**
 * Validate an entry and post nothing.
 *
 * `dryRun` all the way down — the same code path a real posting takes, so what
 * comes back is what would happen rather than a second opinion about it. An
 * agent can check its own arithmetic, find out which period the date lands in
 * and whether that period is closed, and then tell a human what to post.
 *
 * There is no `post_journal_entry` beside it. The journal is append-only and
 * hash-chained: there is no draft state to release from, so an agent posting to
 * it would *be* the release.
 */
export async function checkJournalEntry(
  context: ToolContext,
  input: z.infer<typeof checkJournalEntryInput>,
): Promise<Answer<Record<string, unknown>>> {
  const body = await context.api.post<Record<string, unknown>>('/journal-entries', {
    ...input,
    sourceDocumentRef: null,
    reversesEntryId: null,
    dryRun: true,
    lines: input.lines.map((line, index) => ({
      ...line,
      debit: minorUnitsFrom(line.debit, `lines.${String(index)}.debit`),
      credit: minorUnitsFrom(line.credit, `lines.${String(index)}.credit`),
      taxAmount:
        line.taxAmount === null
          ? null
          : minorUnitsFrom(line.taxAmount, `lines.${String(index)}.taxAmount`),
    })),
  })

  return answer(await context.provenance(['POST /journal-entries (dryRun)']), {
    checked: true,
    posted: false,
    wouldCreate: body,
    release:
      'Nothing was written. A human posts this at Journaalposten → Nieuwe journaalpost, or a token with ledger:post can do it over the API.',
  })
}

// ---------------------------------------------------------------------------
// draft_sales_invoice
// ---------------------------------------------------------------------------

export const draftSalesInvoiceInput = z.object({
  contactNumber: z
    .string()
    .min(1)
    .describe('The debiteurennummer. See list_open_items or Relaties.'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['invoice', 'credit_note']).default('invoice'),
  reference: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.string().default('1'),
        unitPrice: z.string().describe('Decimal string, excluding VAT.'),
        revenueAccountNumber: z.string().min(1).describe('From describe_schema.'),
        taxCode: z.string().min(1).describe('From describe_schema.'),
      }),
    )
    .min(1),
})

/**
 * Create a draft sales invoice.
 *
 * A draft has no number and no journal entry: the gapless series is allocated
 * at issue, which is the moment the invoice legally exists. So this cannot
 * consume a number, and an agent's mistake costs a deletion rather than a gap
 * somebody has to explain to the Belastingdienst.
 */
export async function draftSalesInvoice(
  context: ToolContext,
  input: z.infer<typeof draftSalesInvoiceInput>,
): Promise<Answer<Record<string, unknown>>> {
  const body = await context.api.post<{ id: string; total?: unknown }>('/sales-invoices', {
    ...input,
    buyerReference: null,
    creditsInvoiceId: null,
    lines: input.lines.map((line, index) => ({
      ...line,
      unitPrice: minorUnitsFrom(line.unitPrice, `lines.${String(index)}.unitPrice`),
    })),
  })

  return answer(await context.provenance(['POST /sales-invoices']), {
    draftId: body.id,
    status: 'draft',
    ...body,
    release: `Not issued. It has no number and no journal entry until a human issues it at Verkoopfacturen → ${body.id}.`,
  })
}

// ---------------------------------------------------------------------------
// capture_purchase_invoice
// ---------------------------------------------------------------------------

export const capturePurchaseInvoiceInput = z.object({
  contactNumber: z.string().min(1).describe('The supplier. See Relaties.'),
  supplierInvoiceNumber: z.string().min(1).describe('Their number, exactly as written.'),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3).default('EUR'),
  // Named for what the API calls them so the mapping is obvious, described for
  // what an agent should send.
  netMinorUnits: z.string().describe('Net total as a decimal string, e.g. "1000.00".'),
  taxMinorUnits: z.string().describe('VAT as a decimal string, e.g. "210.00".'),
  totalMinorUnits: z.string().describe('Gross total as a decimal string, e.g. "1210.00".'),
  kind: z.enum(['invoice', 'credit_note']).default('invoice'),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        accountNumber: z.string().min(1),
        taxCode: z.string().min(1),
        netMinorUnits: z.string(),
        taxMinorUnits: z.string(),
      }),
    )
    .min(1),
})

/**
 * Capture a purchase invoice as a draft.
 *
 * Draft, not booked. Booking makes it a liability and makes its VAT deductible
 * in that period, which is a claim against the Belastingdienst — so it waits
 * for somebody who is prepared to make that claim.
 *
 * The totals the supplier stated are sent as given rather than recomputed. On
 * a purchase invoice their arithmetic is the document and our job is to check
 * it, so an agent quietly correcting a rounding difference would be hiding the
 * thing worth seeing.
 */
export async function capturePurchaseInvoice(
  context: ToolContext,
  input: z.infer<typeof capturePurchaseInvoiceInput>,
): Promise<Answer<Record<string, unknown>>> {
  const body = await context.api.post<{ id: string }>('/purchase-invoices', {
    ...input,
    paymentReference: null,
    notes: null,
    netMinorUnits: minorUnitsFrom(input.netMinorUnits, 'netMinorUnits'),
    taxMinorUnits: minorUnitsFrom(input.taxMinorUnits, 'taxMinorUnits'),
    totalMinorUnits: minorUnitsFrom(input.totalMinorUnits, 'totalMinorUnits'),
    lines: input.lines.map((line, index) => ({
      ...line,
      netMinorUnits: minorUnitsFrom(line.netMinorUnits, `lines.${String(index)}.netMinorUnits`),
      taxMinorUnits: minorUnitsFrom(line.taxMinorUnits, `lines.${String(index)}.taxMinorUnits`),
    })),
  })

  return answer(await context.provenance(['POST /purchase-invoices']), {
    draftId: body.id,
    status: 'draft',
    ...body,
    release: `Not booked. A human books it at Inkoopfacturen → ${body.id}, which is when it becomes a liability and its VAT becomes deductible.`,
  })
}

// ---------------------------------------------------------------------------
// draft_from_inbox_item
// ---------------------------------------------------------------------------

export const draftFromInboxItemInput = z.object({
  itemId: z.string().min(1).describe('From the Postvak, or list_pending_approvals.'),
})

/**
 * Turn something that arrived in the inbox into a draft purchase invoice.
 *
 * The most useful write an agent has, because the alternative is a person
 * retyping a PDF. It still lands as a draft, and the document stays attached to
 * it, so the human releasing it is looking at the invoice rather than at a
 * summary of one.
 */
export async function draftFromInboxItem(
  context: ToolContext,
  input: z.infer<typeof draftFromInboxItemInput>,
): Promise<Answer<Record<string, unknown>>> {
  const body = await context.api.post<Record<string, unknown>>(
    `/inbox/${encodeURIComponent(input.itemId)}/draft`,
    {},
  )

  return answer(await context.provenance([`POST /inbox/${input.itemId}/draft`]), {
    status: 'draft',
    ...body,
    release:
      'Not booked. A human checks it against the attached document at Inkoopfacturen and books it there.',
  })
}
