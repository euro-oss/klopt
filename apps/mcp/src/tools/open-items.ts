import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, money, summarise, type Answer } from '../provenance.js'

/**
 * `list_open_items` — "Debtors and creditors with ageing" (spec 10.3).
 *
 * Both sides from one call, because "who owes us and who do we owe" is one
 * question a human asks and two reports the system keeps. An agent given only
 * one of them will answer the other from the wrong list.
 *
 * The creditor side carries the API's own reconciliation between the subledger
 * and the control account. That is not padding: an ageing that does not tie to
 * the ledger is a number to stop quoting, and the agent should be able to say
 * so rather than reporting it as fact.
 */

export const listOpenItemsInput = z.object({
  side: z.enum(['receivable', 'payable', 'both']).optional(),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Defaults to today.'),
  limit: z.number().int().min(1).max(200).optional(),
})

interface OverdueInvoice {
  readonly id: string
  readonly number: string | null
  readonly contactName: string
  readonly dueDate: string
  readonly total: string
  readonly daysOverdue: number
}

interface AgeingBucket {
  readonly contactNumber: string
  readonly contactName: string
  readonly current: string
  readonly upTo30: string
  readonly upTo60: string
  readonly upTo90: string
  readonly over90: string
  readonly total: string
}

interface CreditorAgeing {
  readonly asOf: string
  readonly payableAccountNumber: string
  readonly buckets: readonly AgeingBucket[]
  readonly total: string
  readonly reconciliation: {
    readonly subledger: string
    readonly controlAccount: string
    readonly difference: string
  }
}

export async function listOpenItems(
  context: ToolContext,
  input: z.infer<typeof listOpenItemsInput>,
): Promise<Answer<Record<string, unknown>>> {
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10)
  const side = input.side ?? 'both'
  const sources: string[] = []
  const data: Record<string, unknown> = {}
  let truncated

  if (side === 'receivable' || side === 'both') {
    const body = await context.api.get<{ invoices: OverdueInvoice[] }>(
      '/reports/overdue-invoices',
      { asOf },
    )
    sources.push('/api/v1/reports/overdue-invoices')
    const capped = summarise(body.invoices, input.limit)
    data['receivable'] = {
      count: body.invoices.length,
      invoices: capped.rows.map((invoice) => ({
        invoiceId: invoice.id,
        number: invoice.number,
        customer: invoice.contactName,
        dueDate: invoice.dueDate,
        outstanding: money(invoice.total),
        daysOverdue: invoice.daysOverdue,
        drillDown: `GET /api/v1/sales-invoices/${invoice.id}`,
      })),
    }
    truncated = capped.truncated
  }

  if (side === 'payable' || side === 'both') {
    const body = await context.api.get<CreditorAgeing>('/reports/creditor-ageing', { asOf })
    sources.push('/api/v1/reports/creditor-ageing')
    const capped = summarise(body.buckets, input.limit)
    data['payable'] = {
      total: money(body.total),
      controlAccount: body.payableAccountNumber,
      // Said out loud rather than left for the agent to compute, and phrased so
      // that "it reconciles" is a claim the tool makes only when it is true.
      reconciles: body.reconciliation.difference === '0',
      reconciliation: {
        subledger: money(body.reconciliation.subledger),
        controlAccount: money(body.reconciliation.controlAccount),
        difference: money(body.reconciliation.difference),
      },
      suppliers: capped.rows.map((bucket) => ({
        contactNumber: bucket.contactNumber,
        contactName: bucket.contactName,
        current: money(bucket.current),
        upTo30: money(bucket.upTo30),
        upTo60: money(bucket.upTo60),
        upTo90: money(bucket.upTo90),
        over90: money(bucket.over90),
        total: money(bucket.total),
      })),
    }
    truncated ??= capped.truncated
  }

  return answer(await context.provenance(sources, { asOf }), data, truncated)
}
