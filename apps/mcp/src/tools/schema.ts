import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, summarise, type Answer } from '../provenance.js'

/**
 * `describe_schema` — "Chart of accounts, dimensions, tax codes, so the agent
 * stops guessing" (spec 10.3).
 *
 * The most important read tool, and the one an agent should call first. Every
 * other question is phrased in terms of an account number, a tax code or a
 * dagboek, and an agent that has not been told what exists will invent
 * plausible ones: `1300` for debtors because it usually is, `21` for high-rate
 * VAT because it usually is. Usually is not always, and a chart migrated out
 * of another system is exactly where it is not.
 */

export const describeSchemaInput = z.object({
  /**
   * Which parts to return. All of them by default — this is the orientation
   * call, and a chart of two hundred accounts is still smaller than the
   * conversation that follows guessing at one.
   */
  include: z
    .array(z.enum(['accounts', 'journals', 'taxCodes', 'fiscalYears']))
    .optional()
    .describe('Defaults to all four.'),
  /** Blocked accounts are hidden unless asked for: they cannot be posted to. */
  includeBlocked: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

interface Account {
  readonly number: string
  readonly name: string
  readonly type: string
  readonly normalBalance: string
  readonly rgsCode: string | null
  readonly isBlocked: boolean
  readonly defaultTaxCode: string | null
}

interface Journal {
  readonly code: string
  readonly name: string
  readonly type: string
}

interface TaxCode {
  readonly code: string
  readonly description?: string
  readonly ratePercentage?: string
}

interface FiscalYear {
  readonly code: string
  readonly startsOn: string
  readonly endsOn: string
  readonly status: string
}

export async function describeSchema(
  context: ToolContext,
  input: z.infer<typeof describeSchemaInput>,
): Promise<Answer<Record<string, unknown>>> {
  const include = new Set(input.include ?? ['accounts', 'journals', 'taxCodes', 'fiscalYears'])
  const sources: string[] = ['/api/v1/entity']
  const data: Record<string, unknown> = {}
  let truncated

  if (include.has('accounts')) {
    const body = await context.api.get<{ accounts: Account[] }>('/accounts')
    sources.push('/api/v1/accounts')
    const usable =
      input.includeBlocked === true
        ? body.accounts
        : body.accounts.filter((account) => !account.isBlocked)

    // A bigger default than the other tools: the chart is the vocabulary, and
    // truncating it is what makes an agent guess at the account it cannot see.
    const capped = summarise(usable, input.limit ?? 500)
    data['accounts'] = capped.rows.map((account) => ({
      number: account.number,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance,
      rgsCode: account.rgsCode,
      defaultTaxCode: account.defaultTaxCode,
      ...(account.isBlocked ? { blocked: true } : {}),
    }))
    data['accountCount'] = usable.length
    truncated = capped.truncated
  }

  if (include.has('journals')) {
    const body = await context.api.get<{ journals: Journal[] }>('/journals')
    sources.push('/api/v1/journals')
    data['journals'] = body.journals
  }

  if (include.has('taxCodes')) {
    const body = await context.api.get<{ taxCodes: TaxCode[] }>('/tax-codes')
    sources.push('/api/v1/tax-codes')
    data['taxCodes'] = body.taxCodes
  }

  if (include.has('fiscalYears')) {
    const body = await context.api.get<{ fiscalYears: FiscalYear[] }>('/fiscal-years')
    sources.push('/api/v1/fiscal-years')
    data['fiscalYears'] = body.fiscalYears
  }

  return answer(await context.provenance(sources), data, truncated)
}
