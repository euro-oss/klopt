import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, money, summarise, type Answer } from '../provenance.js'

/**
 * `explain_number` — "Given a reported figure (a rubriek, a P&L line, an aged
 * total), return the journal lines that produced it" (spec 10.3).
 *
 * The tool the provenance rule is really about. An agent asked "why is 1a
 * €29.400" can either cite the lines or invent a story, and the difference
 * between those two is whether this exists.
 *
 * `ties` is passed through and said out loud, because it is the one part an
 * agent must not paraphrase. A drill-down that does not add up to the figure
 * it drills into is a finding — usually a hand-typed correction — and the
 * agent should report it as one rather than presenting the lines as the
 * explanation.
 */

export const explainNumberInput = z.object({
  figure: z
    .enum(['vat-rubriek', 'account', 'ageing-bucket'])
    .describe('Which kind of reported figure this is.'),
  rubriek: z.string().optional().describe('vat-rubriek: the box, e.g. 1a or 5c.'),
  period: z.string().optional().describe('vat-rubriek: 2026-Q1, 2026-03 or 2026.'),
  component: z
    .enum(['vat', 'base'])
    .optional()
    .describe('vat-rubriek: which of the box’s two figures. Defaults to the VAT.'),
  accountNumber: z.string().optional().describe('account: the grootboekrekening.'),
  fiscalYear: z.string().optional().describe('account: the book year, e.g. 2026.'),
  fromPeriod: z.number().int().min(1).max(13).optional(),
  toPeriod: z.number().int().min(1).max(13).optional(),
  side: z.enum(['debtor', 'creditor']).optional().describe('ageing-bucket: which ledger.'),
  bucket: z
    .enum(['current', 'upTo30', 'upTo60', 'upTo90', 'over90', 'total'])
    .optional()
    .describe('ageing-bucket: which column of the ageing.'),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('ageing-bucket: defaults to today.'),
  limit: z.number().int().min(1).max(200).optional(),
})

interface ExplainLine {
  readonly ref: string
  readonly date: string | null
  readonly accountNumber: string | null
  readonly accountName: string | null
  readonly description: string
  readonly amountMinorUnits: string
  readonly entryId: string | null
  readonly path: string | null
}

interface ExplainBody {
  readonly figure: { readonly kind: string; readonly label: string }
  readonly currency: string
  readonly period: {
    readonly from: string | null
    readonly to: string | null
    readonly asOf: string | null
  }
  readonly basis: string
  readonly amountMinorUnits: string
  readonly openingMinorUnits: string | null
  readonly explainedMinorUnits: string
  readonly unexplainedMinorUnits: string
  readonly ties: boolean
  readonly lineCount: number
  readonly truncated: boolean
  readonly lines: readonly ExplainLine[]
}

export async function explainNumber(
  context: ToolContext,
  input: z.infer<typeof explainNumberInput>,
): Promise<Answer<Record<string, unknown>>> {
  const query: Record<string, string | number | undefined> = {
    figure: input.figure,
    rubriek: input.rubriek,
    period: input.period,
    component: input.component,
    accountNumber: input.accountNumber,
    fiscalYear: input.fiscalYear,
    fromPeriod: input.fromPeriod,
    toPeriod: input.toPeriod,
    side: input.side,
    bucket: input.bucket,
    asOf: input.asOf,
    // The API caps its own list; this asks for no more than the agent will be
    // shown, so the two truncations do not disagree.
    limit: input.limit,
  }

  const body = await context.api.get<ExplainBody>('/explain', query)
  const capped = summarise(body.lines, input.limit)

  return answer(
    await context.provenance(['/api/v1/explain'], {
      ...(body.period.from === null ? {} : { from: body.period.from }),
      ...(body.period.to === null ? {} : { to: body.period.to }),
      ...(body.period.asOf === null ? {} : { asOf: body.period.asOf }),
    }),
    {
      figure: body.figure.label,
      amount: money(body.amountMinorUnits),
      // What the evidence below adds up to, and whether that is the figure.
      // Never collapsed into one boolean: an agent that says "it reconciles"
      // should be able to say by how much it does not.
      explained: money(body.explainedMinorUnits),
      unexplained: money(body.unexplainedMinorUnits),
      ties: body.ties,
      openingBalance: body.openingMinorUnits === null ? null : money(body.openingMinorUnits),
      /**
       * What the lines are. `open-items` means invoices rather than journal
       * lines, and `rubrieken` means this box is a subtotal of other boxes —
       * either way the agent should say which it saw.
       */
      basis: body.basis,
      lineCount: body.lineCount,
      lines: capped.rows.map((line) => ({
        ref: line.ref,
        date: line.date,
        account:
          line.accountNumber === null
            ? line.accountName
            : `${line.accountNumber} ${line.accountName ?? ''}`.trim(),
        description: line.description,
        amount: money(line.amountMinorUnits),
        drillDown: line.path === null ? null : `GET /api/v1${line.path}`,
      })),
    },
    body.truncated && capped.truncated === undefined
      ? {
          shown: capped.rows.length,
          totalCount: body.lineCount,
          more: `Showing ${String(capped.rows.length)} of ${String(body.lineCount)} lines. The totals above cover all of them. Ask again with a higher limit, or narrow the period.`,
        }
      : capped.truncated,
  )
}
