import { createServerFn } from '@tanstack/react-start'
import { handleListInvoices, handleListOverdueInvoices } from '~/api/handlers/sales'
import { handleListBankTransactions } from '~/api/handlers/bank'
import { handleListInbox } from '~/api/handlers/inbox'
import { handleListPurchaseInvoices } from '~/api/handlers/purchase'
import { listPurchaseInvoicesQuery } from '~/api/schemas'
import { buildWorkQueue } from '~/lib/work-queue'
import { withinFiscalYear } from '~/lib/fiscal-year'
import { contextFromRequest, reportYear, run } from './internal'

/**
 * What is waiting, for the dashboard.
 *
 * One call rather than five, and that is deliberate. Every other module here
 * is one server function per handler, because the screen and the endpoint
 * should not disagree about what a status is — but a work queue is a question
 * about five subsystems at once, and asking it as five round trips would mean
 * the year has to be resolved before the first of them can be sent. The reads
 * are the same handlers `/api/v1` serves; nothing new is modelled here and
 * nothing is written.
 *
 * The counts are what the selected book year contains. Each row is dated by
 * the thing it is about — an invoice by its issue date, a bank line by its
 * booking date, an arrival by when it arrived — so switching the year in the
 * shell moves the queue with it rather than leaving a figure from a year the
 * reader is not looking at.
 *
 * The limits are generous rather than absent. A queue is a list of work, and a
 * number that says "more than a thousand bank lines are unmatched" and one
 * that says exactly how many past that point lead to the same afternoon.
 */

const SCAN_LIMIT = 1000

export const getWorkQueue = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => {
    const context = await contextFromRequest()
    const { scope } = await reportYear(context)

    const [drafts, overdue, transactions, inbox, purchases] = await Promise.all([
      handleListInvoices(context, { status: 'draft', limit: 500, updatedSince: null }),
      handleListOverdueInvoices(context, { asOf: scope.asOf }),
      handleListBankTransactions(context, {
        bankAccountId: null,
        status: 'unmatched',
        limit: SCAN_LIMIT,
      }),
      handleListInbox(context, { state: 'new' }),
      handleListPurchaseInvoices(context, listPurchaseInvoicesQuery.parse({})),
    ])

    const overdueInYear = overdue.body.invoices.filter((invoice) =>
      withinFiscalYear(scope, invoice.dueDate),
    )
    const purchasesInYear = purchases.body.invoices.filter((invoice) =>
      withinFiscalYear(scope, invoice.invoiceDate),
    )

    const items = buildWorkQueue({
      salesDrafts: drafts.body.invoices.filter((invoice) =>
        withinFiscalYear(scope, invoice.issueDate),
      ).length,
      salesOverdue: overdueInYear.length,
      salesOverdueTotal: overdueInYear
        .reduce((sum, invoice) => sum + BigInt(invoice.total), 0n)
        .toString(),
      bankUnmatched: transactions.body.transactions.filter((transaction) =>
        withinFiscalYear(scope, transaction.bookingDate),
      ).length,
      inboxWaiting: inbox.body.items.filter((item) => withinFiscalYear(scope, item.receivedAt))
        .length,
      purchaseToBook: purchasesInYear.filter((invoice) => invoice.status === 'draft').length,
      purchaseToApprove: purchasesInYear.filter((invoice) => invoice.status === 'booked').length,
    })

    return { fiscalYear: scope, items }
  }),
)
