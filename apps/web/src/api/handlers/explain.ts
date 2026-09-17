import {
  OWED_RUBRIEKEN,
  findRubriek,
  parseVatPeriodCode,
  rubriekAmounts,
  type VatReturn,
} from '@klopt/core'
import { withPurchaseRead, withReporting, withSalesRead, withVatRead } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { ExplainQuery } from '../schemas.js'

/**
 * Where a reported figure came from (spec 10.3).
 *
 * > Given a reported figure (a rubriek, a P&L line, an aged total), return the
 * > journal lines that produced it.
 *
 * ## It has to be able to say no
 *
 * The field that earns this route its place is `ties`. Everything else here is
 * a list, and a list is only evidence if the thing it is offered as evidence
 * *for* was checked against it. So every figure is fetched from the report
 * that publishes it, the lines are summed independently, and the difference is
 * reported. `ties: false` with a named `unexplainedMinorUnits` is a useful
 * answer — it is the moment somebody finds a hand-typed correction — and
 * quietly returning the lines as though they added up would hide exactly that.
 *
 * ## One line shape for three kinds of evidence
 *
 * A rubriek is explained by journal lines, an ageing bucket by open invoices,
 * and a computed rubriek by the boxes it sums. Those are three different
 * things and `basis` says which one arrived, but they share a shape: a
 * reference, an amount, and a path to read the whole thing. A client that only
 * knows how to render "reference, amount, drill-down" renders all three.
 *
 * ## Signs are debit-positive throughout
 *
 * Statements present every figure positive, given the side of the sheet it
 * belongs on, which is how a Dutch balance sheet reads and which is useless
 * for arithmetic across sides. Here a debit is positive everywhere, so the
 * lines genuinely sum to the figure and `ties` means something.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

/** One element of the evidence, whatever the evidence is made of. */
interface ExplainLine {
  /** How a human names it: `MEM 12`, `F-2026-0042`, `1a`. */
  readonly ref: string
  readonly date: string | null
  readonly accountNumber: string | null
  readonly accountName: string | null
  readonly description: string
  readonly amountMinorUnits: bigint
  readonly entryId: string | null
  /** Relative to /api/v1, or null where the thing has no read of its own. */
  readonly path: string | null
}

interface Explanation {
  readonly label: string
  readonly basis: 'journal-lines' | 'open-items' | 'rubrieken'
  readonly amountMinorUnits: bigint
  /** Carried from before the range, on a balance-sheet account. */
  readonly openingMinorUnits: bigint | null
  readonly period: { from: string | null; to: string | null; asOf: string | null }
  readonly currency: string
  readonly lines: readonly ExplainLine[]
}

function serialiseLine(line: ExplainLine) {
  return {
    ref: line.ref,
    date: line.date,
    accountNumber: line.accountNumber,
    accountName: line.accountName,
    description: line.description,
    amountMinorUnits: line.amountMinorUnits.toString(),
    entryId: line.entryId,
    path: line.path,
  }
}

/**
 * A BTW box.
 *
 * The computed subtotals — 5a, 5c — have no lines of their own, because no tax
 * code may point at one. Their explanation is the boxes they sum, each with a
 * route to go a level deeper, which is the true answer rather than a
 * flattening that would silently drop the minus sign in 5c.
 */
async function explainRubriek(
  context: RequestContext,
  query: ExplainQuery,
  rubriekId: string,
  periodCode: string,
): Promise<Explanation> {
  const rubriek = findRubriek(rubriekId)
  if (rubriek === undefined) {
    throw new ApiError('not_found', `There is no rubriek ${rubriekId} on the aangifte.`)
  }
  const period = parseVatPeriodCode(periodCode)

  return withVatRead(context.database, async (repository) => {
    const vatReturn: VatReturn = await repository.buildReturn({
      entityId: context.entityId,
      from: period.from,
      to: period.to,
    })

    const amounts = rubriekAmounts(vatReturn, rubriek.id)
    const amount = query.component === 'vat' ? amounts.vatMinorUnits : amounts.baseMinorUnits
    const shared = {
      label: `${rubriek.id} ${rubriek.label} (${query.component})`,
      amountMinorUnits: amount,
      openingMinorUnits: null,
      period: { from: period.from, to: period.to, asOf: null },
      currency: 'EUR',
    }

    if (rubriek.computed) {
      // 5a is the sum of what is owed; 5c is 5a less 5b. Both are stated as
      // their parts, signed so that they add up to the figure.
      const parts =
        rubriek.id === '5c'
          ? [
              { id: '5a', sign: 1n },
              { id: '5b', sign: -1n },
            ]
          : OWED_RUBRIEKEN.map((id) => ({ id, sign: 1n }))

      return {
        ...shared,
        basis: 'rubrieken' as const,
        lines: parts.map((part) => {
          const found = findRubriek(part.id)
          return {
            ref: part.id,
            date: null,
            accountNumber: null,
            accountName: null,
            description: found?.label ?? part.id,
            amountMinorUnits: part.sign * rubriekAmounts(vatReturn, part.id).vatMinorUnits,
            entryId: null,
            path: `/explain?figure=vat-rubriek&rubriek=${part.id}&period=${periodCode}`,
          }
        }),
      }
    }

    const total = vatReturn.rubrieken.find((entry) => entry.rubriek.id === rubriek.id)
    // The form calls the two figures a base and its VAT; the journal line
    // calls its role `base` or `tax`. The caller speaks the form's language.
    const role = query.component === 'vat' ? 'tax' : 'base'

    return {
      ...shared,
      basis: 'journal-lines' as const,
      lines: (total?.lines ?? [])
        .filter((line) => line.taxRole === role)
        .map((line) => ({
          ref: `${line.journalCode} ${line.entryNumber}`,
          date: line.bookingDate,
          accountNumber: line.accountNumber,
          accountName: line.accountName,
          description: line.description,
          amountMinorUnits: line.amountMinorUnits,
          entryId: line.entryId,
          path: `/journal-entries/${line.entryId}`,
        })),
    }
  })
}

/** A line on the trial balance, the balance sheet or the P&L. */
async function explainAccount(
  context: RequestContext,
  query: ExplainQuery,
  accountNumber: string,
  fiscalYear: string,
): Promise<Explanation> {
  const request = {
    entityId: context.entityId,
    fiscalYearCode: fiscalYear,
    fromPeriod: query.fromPeriod,
    toPeriod: query.toPeriod,
    currency: query.currency,
  }

  return withReporting(context.database, async (repository) => {
    const rows = await repository.trialBalanceRows(request)
    const row = rows.find((candidate) => candidate.accountNumber === accountNumber)
    if (row === undefined) {
      throw new ApiError(
        'not_found',
        `There is no account ${accountNumber} in this chart for ${fiscalYear}.`,
      )
    }

    const range = await repository.periodRange(
      context.entityId,
      fiscalYear,
      query.fromPeriod,
      query.toPeriod,
    )
    const lines = await repository.accountLines({ ...request, accountNumber })

    // A profit-and-loss account is reported as the movement in the range; a
    // balance-sheet account as what it stands at, which includes everything
    // that closed before the range began.
    const isResultAccount = row.accountType === 'revenue' || row.accountType === 'expense'
    const opening = row.openingDebit - row.openingCredit
    const movement = row.periodDebit - row.periodCredit

    return {
      label: `${row.accountNumber} ${row.accountName}`,
      basis: 'journal-lines' as const,
      amountMinorUnits: isResultAccount ? movement : opening + movement,
      openingMinorUnits: isResultAccount ? null : opening,
      period: { from: range?.fromDate ?? null, to: range?.toDate ?? null, asOf: null },
      currency: query.currency,
      lines: lines.map((line) => ({
        ref: `${line.journalCode} ${line.entryNumber}`,
        date: line.bookingDate,
        accountNumber: row.accountNumber,
        accountName: row.accountName,
        description: line.description,
        amountMinorUnits: line.signedMinorUnits,
        entryId: line.entryId,
        path: `/journal-entries/${line.entryId}`,
      })),
    }
  })
}

type Bucket = 'current' | 'upTo30' | 'upTo60' | 'upTo90' | 'over90'

/** Which of the five an invoice falls in, counted in days past its due date. */
function bucketOf(dueDate: string, asOf: string): Bucket {
  const days = Math.floor((Date.parse(asOf) - Date.parse(dueDate)) / 86_400_000)
  if (days <= 0) return 'current'
  if (days <= 30) return 'upTo30'
  if (days <= 60) return 'upTo60'
  if (days <= 90) return 'upTo90'
  return 'over90'
}

/**
 * An aged total, on either side.
 *
 * The buckets are recomputed here from the same open items the reports use,
 * rather than read off the report, because a report gives a total per
 * counterparty and the question is which invoices are in it.
 */
async function explainAgeing(
  context: RequestContext,
  query: ExplainQuery,
  side: 'debtor' | 'creditor',
): Promise<Explanation> {
  const wanted = query.bucket
  const keep = (dueDate: string) => wanted === 'total' || bucketOf(dueDate, query.asOf) === wanted

  const shared = {
    basis: 'open-items' as const,
    openingMinorUnits: null,
    period: { from: null, to: null, asOf: query.asOf },
  }

  if (side === 'creditor') {
    return withPurchaseRead(context.database, async (repository) => {
      const open = await repository.list(context.entityId, { openOnly: true })
      const inBucket = open.filter((invoice) => keep(invoice.dueDate))

      return {
        ...shared,
        label: `Crediteuren ${wanted ?? 'total'} per ${query.asOf}`,
        currency: 'EUR',
        amountMinorUnits: inBucket.reduce((sum, invoice) => sum + invoice.outstanding, 0n),
        lines: inBucket.map((invoice) => ({
          ref: invoice.supplierInvoiceNumber,
          date: invoice.dueDate,
          accountNumber: null,
          accountName: invoice.contactName,
          description: `${invoice.contactNumber} ${invoice.contactName}`,
          amountMinorUnits: invoice.outstanding,
          entryId: invoice.journalEntryId,
          path: `/purchase-invoices/${invoice.id}`,
        })),
      }
    })
  }

  return withSalesRead(context.database, async (repository) => {
    const open = await repository.openInvoices(context.entityId, null)
    const inBucket = open.filter((invoice) => keep(invoice.dueDate))

    return {
      ...shared,
      label: `Debiteuren ${wanted ?? 'total'} per ${query.asOf}`,
      currency: 'EUR',
      amountMinorUnits: inBucket.reduce((sum, invoice) => sum + invoice.total, 0n),
      lines: inBucket.map((invoice) => ({
        ref: invoice.number ?? invoice.id.slice(0, 8),
        date: invoice.dueDate,
        accountNumber: null,
        accountName: invoice.contactName,
        description: invoice.contactName,
        amountMinorUnits: invoice.total,
        entryId: null,
        path: `/sales-invoices/${invoice.id}`,
      })),
    }
  })
}

export async function handleExplainNumber(context: RequestContext, query: ExplainQuery) {
  requirePermission(context, 'ledger:read')

  // The schema's refine has already established that the fields each figure
  // needs are present; the non-null assertions below would be the only place a
  // caller could reach with a null, and they cannot.
  const explanation =
    query.figure === 'vat-rubriek'
      ? await explainRubriek(context, query, query.rubriek!, query.period!)
      : query.figure === 'account'
        ? await explainAccount(context, query, query.accountNumber!, query.fiscalYear!)
        : await explainAgeing(context, query, query.side!)

  const shown = explanation.lines.slice(0, query.limit)
  const summed = explanation.lines.reduce((total, line) => total + line.amountMinorUnits, 0n)
  const explained = (explanation.openingMinorUnits ?? 0n) + summed
  const unexplained = explanation.amountMinorUnits - explained

  return {
    status: 200,
    body: {
      figure: {
        kind: query.figure,
        label: explanation.label,
        rubriek: query.rubriek,
        component: query.figure === 'vat-rubriek' ? query.component : null,
        accountNumber: query.accountNumber,
        fiscalYear: query.fiscalYear,
        side: query.side,
        bucket: query.bucket,
      },
      entityId: context.entityId,
      currency: explanation.currency,
      period: explanation.period,
      basis: explanation.basis,
      /** Debit-positive, as published by the report that owns the figure. */
      amountMinorUnits: explanation.amountMinorUnits.toString(),
      openingMinorUnits: explanation.openingMinorUnits?.toString() ?? null,
      /** What the lines below actually add up to, plus any opening balance. */
      explainedMinorUnits: explained.toString(),
      unexplainedMinorUnits: unexplained.toString(),
      /**
       * Whether the evidence accounts for the figure. The reason this route
       * exists: a drill-down nobody checked is a list, not an explanation.
       */
      ties: unexplained === 0n,
      lineCount: explanation.lines.length,
      /**
       * The list is cut; the arithmetic above is not. `explainedMinorUnits`
       * sums every line, shown or not — a total that only counted the visible
       * rows would make `ties` false on exactly the large figures somebody
       * most wants to check.
       */
      truncated: explanation.lines.length > shown.length,
      lines: shown.map(serialiseLine),
    },
  }
}
