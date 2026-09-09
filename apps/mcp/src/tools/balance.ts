import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, money, summarise, type Answer } from '../provenance.js'

/**
 * `get_balance` — "Account or dimension balance for a period, with drill-down
 * ids" (spec 10.3).
 *
 * The drill-down half is the part that matters. A balance an agent cannot take
 * apart is a number it will paraphrase, and a paraphrased number in a board
 * pack is the failure mode the provenance rule exists to prevent. So every row
 * carries the account it belongs to and the query that would show its lines.
 */

export const getBalanceInput = z.object({
  fiscalYear: z.string().min(1).describe('The book year code, e.g. "2026". See describe_schema.'),
  fromPeriod: z.number().int().min(1).max(13).optional(),
  toPeriod: z.number().int().min(1).max(13).optional(),
  /** One account, or all of them. */
  accountNumber: z.string().optional(),
  /** Accounts with no movement and no balance are omitted unless asked for. */
  includeZero: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

interface TrialBalanceLine {
  readonly accountNumber: string
  readonly accountName: string
  readonly accountType: string
  readonly rgsCode: string | null
  readonly openingBalance: string
  readonly debit: string
  readonly credit: string
  readonly closingBalance: string
}

interface TrialBalance {
  readonly currency: string
  readonly fiscalYear: string
  readonly fromPeriod: number
  readonly toPeriod: number
  readonly totalDebit: string
  readonly totalCredit: string
  readonly difference: string
  readonly lines: readonly TrialBalanceLine[]
}

export async function getBalance(
  context: ToolContext,
  input: z.infer<typeof getBalanceInput>,
): Promise<Answer<Record<string, unknown>>> {
  const fromPeriod = input.fromPeriod ?? 1
  const toPeriod = input.toPeriod ?? 13

  const body = await context.api.get<TrialBalance>('/reports/trial-balance', {
    fiscalYear: input.fiscalYear,
    fromPeriod,
    toPeriod,
    includeZeroRows: input.includeZero === true ? 'true' : 'false',
  })

  const wanted =
    input.accountNumber === undefined
      ? body.lines
      : body.lines.filter((line) => line.accountNumber === input.accountNumber)

  // Asking about one account and being told nothing is ambiguous: no such
  // account, or no movement on it? The difference matters to whatever the agent
  // says next.
  if (input.accountNumber !== undefined && wanted.length === 0) {
    return answer(
      await context.provenance(['/api/v1/reports/trial-balance'], {
        fiscalYear: body.fiscalYear,
        fromPeriod: body.fromPeriod,
        toPeriod: body.toPeriod,
      }),
      {
        accountNumber: input.accountNumber,
        found: false,
        note: 'No balance for that account in this period. It may not exist, or it may have no movement — call describe_schema to tell those apart.',
      },
    )
  }

  const capped = summarise(wanted, input.limit)

  return answer(
    await context.provenance(['/api/v1/reports/trial-balance'], {
      fiscalYear: body.fiscalYear,
      fromPeriod: body.fromPeriod,
      toPeriod: body.toPeriod,
    }),
    {
      totals: {
        debit: money(body.totalDebit),
        credit: money(body.totalCredit),
        // Not derived here. If the ledger says these disagree, that is a fact
        // worth surfacing rather than one to recompute into agreement.
        difference: money(body.difference),
        balanced: body.difference === '0' || Number(body.difference) === 0,
      },
      accounts: capped.rows.map((line) => ({
        accountNumber: line.accountNumber,
        accountName: line.accountName,
        accountType: line.accountType,
        rgsCode: line.rgsCode,
        openingBalance: money(line.openingBalance),
        debit: money(line.debit),
        credit: money(line.credit),
        closingBalance: money(line.closingBalance),
        // The drill-down the spec asks for: how to see what made this number.
        drillDown: `GET /api/v1/journal-entries?accountNumber=${line.accountNumber}&fiscalYear=${body.fiscalYear}`,
      })),
    },
    capped.truncated,
  )
}
