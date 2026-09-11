import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import {
  bookPurchaseInvoice,
  getPurchaseInvoice,
  transitionPurchaseInvoice,
} from '~/server/purchase'

/**
 * One supplier invoice.
 *
 * The findings are the point of the screen. They are recomputed on every read
 * rather than stored, because a capture goes stale — a tax code's validity
 * window closes, the same invoice number turns up twice — and a finding that
 * only appeared at the moment of booking would appear too late to be useful.
 *
 * The three severities read differently on purpose. Blocking means the capture
 * is not the document and booking is refused. A warning means the capture is
 * faithful and something is worth a look. A note is neither: it is a
 * consequence, usually that the VAT reaching rubriek 5b is smaller than the VAT
 * on the paper, and somebody reconciling the two should not have to work out
 * why.
 */
export const Route = createFileRoute('/_app/purchases/$invoiceId')({
  loader: async ({ params }) => ({
    invoice: await getPurchaseInvoice({ data: { invoiceId: params.invoiceId } }),
  }),
  component: PurchaseInvoiceScreen,
})

const FINDING_KEY: Record<string, MessageKey> = {
  lines_do_not_sum_to_net: 'purchase.finding.lines_do_not_sum_to_net',
  lines_do_not_sum_to_tax: 'purchase.finding.lines_do_not_sum_to_tax',
  net_plus_tax_is_not_total: 'purchase.finding.net_plus_tax_is_not_total',
  rate_mismatch: 'purchase.finding.rate_mismatch',
  reverse_charge_with_tax: 'purchase.finding.reverse_charge_with_tax',
  unknown_tax_code: 'purchase.finding.unknown_tax_code',
  no_rule_in_force: 'purchase.finding.no_rule_in_force',
  not_deductible: 'purchase.finding.not_deductible',
  pro_rata: 'purchase.finding.pro_rata',
  duplicate_invoice_number: 'purchase.finding.duplicate_invoice_number',
}

const SEVERITY_KEY: Record<string, MessageKey> = {
  blocking: 'purchase.severity.blocking',
  warning: 'purchase.severity.warning',
  note: 'purchase.severity.note',
}

function PurchaseInvoiceScreen() {
  const { invoice } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  /** An unrecognised code is shown raw rather than swallowed. */
  const findingOf = (code: string) => {
    const key = FINDING_KEY[code]
    return key === undefined ? code : t(key)
  }
  const severityOf = (severity: string) => {
    const key = SEVERITY_KEY[severity]
    return key === undefined ? severity : t(key)
  }

  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [disputing, setDisputing] = useState(false)
  const key = useRef<string>(crypto.randomUUID())

  if (!invoice.ok) {
    return (
      <>
        <PageHeader title={t('purchase.title')} />
        <p role="alert" className="text-destructive text-sm">
          {invoice.problem.detail}
        </p>
      </>
    )
  }

  const data = invoice.data
  const blocking = data.findings.filter((finding) => finding.severity === 'blocking')

  async function act(work: () => Promise<{ ok: boolean; problem?: unknown }>): Promise<void> {
    setBusy(true)
    setProblems([])
    const result = (await work()) as
      { ok: true } | { ok: false; problem: { detail: string; violations: { message: string }[] } }
    setBusy(false)
    key.current = crypto.randomUUID()

    if (!result.ok) {
      setProblems(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => item.message)
          : [result.problem.detail],
      )
      return
    }
    setDisputing(false)
    await router.invalidate()
  }

  const book = () =>
    act(() =>
      bookPurchaseInvoice({
        data: { invoiceId: data.id, idempotencyKey: key.current, body: { bookingDate: null } },
      }),
    )

  const transition = (action: 'approve' | 'dispute' | 'resolve' | 'cancel', reason?: string) =>
    act(() =>
      transitionPurchaseInvoice({
        data: {
          invoiceId: data.id,
          idempotencyKey: key.current,
          body: { action, reason: reason ?? null },
        },
      }),
    )

  return (
    <>
      <PageHeader
        title={`${data.kind === 'credit_note' ? t('invoice.creditNote') : t('purchase.title')} ${data.supplierInvoiceNumber}`}
        description={`${data.contactNumber} · ${data.contactName} · ${formatDate(data.invoiceDate)} · ${data.statusLabel}`}
        actions={
          <div className="flex items-center gap-3">
            {data.status === 'draft' && (
              <button
                type="button"
                disabled={!hydrated || busy || !data.bookable}
                onClick={() => {
                  void book()
                }}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? t('common.busy') : t('purchase.book')}
              </button>
            )}
            {data.status === 'booked' && (
              <button
                type="button"
                disabled={!hydrated || busy}
                onClick={() => {
                  void transition('approve')
                }}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? t('common.busy') : t('purchase.approve')}
              </button>
            )}
            {(data.status === 'booked' || data.status === 'approved') && (
              <button
                type="button"
                disabled={!hydrated || busy}
                onClick={() => {
                  setDisputing((current) => !current)
                }}
                className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                {t('purchase.dispute')}
              </button>
            )}
            {data.status === 'disputed' && (
              <button
                type="button"
                disabled={!hydrated || busy}
                onClick={() => {
                  void transition('resolve')
                }}
                className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                {t('purchase.resolve')}
              </button>
            )}
            {data.status === 'draft' && (
              <button
                type="button"
                disabled={!hydrated || busy}
                onClick={() => {
                  void transition('cancel')
                }}
                className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                {t('purchase.cancel')}
              </button>
            )}
            <Link to="/purchases" className="text-sm underline">
              {t('purchase.all')}
            </Link>
          </div>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label={t('purchaseNew.excludingVat')} value={<Money amount={data.net} />} />
        <Stat label={t('invoice.vat')} value={<Money amount={data.tax} />} />
        <Stat label={t('report.total')} value={<Money amount={data.total} />} />
        <Stat
          label={t('purchases.outstanding')}
          value={<Money amount={data.outstanding} />}
          hint={
            data.outstanding === '0'
              ? t('purchase.paid')
              : t('purchase.dueOn', { date: formatDate(data.dueDate) })
          }
          tone={data.outstanding === '0' ? 'good' : 'neutral'}
        />
      </div>

      {disputing && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const reason = form.get('reason')
            void transition('dispute', typeof reason === 'string' ? reason : '')
          }}
          className="border-border mb-8 max-w-2xl space-y-3 rounded-md border p-4"
        >
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('purchase.disputeWhy')}
            </span>
            <textarea
              name="reason"
              required
              rows={2}
              aria-describedby="dispute-hint"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <p id="dispute-hint" className="text-muted-foreground text-xs">
            {t('purchase.disputeHint')}
          </p>
          <button
            type="submit"
            disabled={!hydrated || busy}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {t('purchase.dispute')}
          </button>
        </form>
      )}

      {data.disputedReason !== null && (
        <p className="border-destructive mb-8 max-w-2xl rounded-md border p-3 text-sm">
          <strong className="font-medium">{t('purchase.disputed')}</strong> {data.disputedReason}
        </p>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="text-destructive mb-6 max-w-2xl space-y-1 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-semibold">{t('purchase.lines')}</h2>
      <table className="border-border mb-8 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">{t('purchase.linesCaption')}</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('entries.description')}
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('invoice.ledgerAccount')}
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              {t('purchaseNew.taxCode')}
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              {t('purchaseNew.excludingVat')}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {t('invoice.vat')}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line) => (
            <tr key={line.lineNumber} className="border-border/50 border-t">
              <td className="py-1.5 pr-2">{line.description}</td>
              <td className="tabular py-1.5 pr-2">{line.accountNumber}</td>
              <td className="py-1.5 pr-2">{line.taxCode}</td>
              <td className="py-1.5 pr-2 text-right">
                <Money amount={line.net} />
              </td>
              <td className="py-1.5 text-right">
                <Money amount={line.tax} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.findings.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold">
            {t('purchase.findings')}
            {blocking.length > 0 &&
              t('purchase.findingsBlocking', { count: String(blocking.length) })}
          </h2>
          <ul className="mb-8 max-w-3xl space-y-3">
            {data.findings.map((finding, index) => (
              <li
                key={`${finding.code}-${String(finding.lineNumber ?? index)}`}
                className={
                  finding.severity === 'blocking'
                    ? 'border-destructive rounded-md border p-3 text-sm'
                    : 'border-border rounded-md border p-3 text-sm'
                }
              >
                <p className="font-medium">
                  {severityOf(finding.severity)}: {findingOf(finding.code)}
                  {finding.lineNumber !== null &&
                    t('purchase.findingLine', { line: String(finding.lineNumber) })}
                </p>
                <p className="text-muted-foreground mt-1">{finding.message}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.journalEntryId !== null && (
        <p className="text-sm">
          {t('invoice.postedAs')}{' '}
          <Link
            to="/entries/$entryId"
            params={{ entryId: data.journalEntryId }}
            className="underline"
          >
            {t('purchase.postedAsEntry', { number: data.journalEntryNumber ?? '' })}
          </Link>
          {data.approvedBy !== null && t('purchase.approvedForPayment')}
          {data.payableRefusal !== null && (
            <span className="text-muted-foreground"> · {data.payableRefusal}</span>
          )}
        </p>
      )}
    </>
  )
}
