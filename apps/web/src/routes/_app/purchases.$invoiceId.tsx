import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
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

const FINDING_LABEL: Record<string, string> = {
  lines_do_not_sum_to_net: 'Regels tellen niet op tot het bedrag op de factuur',
  lines_do_not_sum_to_tax: 'Btw op de regels is niet de btw op de factuur',
  net_plus_tax_is_not_total: 'Excl. btw plus btw is niet het totaal',
  rate_mismatch: 'Btw wijkt af van het tarief van de code',
  reverse_charge_with_tax: 'Verlegde btw, maar de factuur brengt btw in rekening',
  unknown_tax_code: 'Btw-code klopt niet',
  no_rule_in_force: 'Btw-code is niet geldig op de factuurdatum',
  not_deductible: 'Btw is niet aftrekbaar',
  pro_rata: 'Btw is gedeeltelijk aftrekbaar',
  duplicate_invoice_number: 'Dit factuurnummer is al eerder geboekt',
}

const SEVERITY_LABEL: Record<string, string> = {
  blocking: 'Blokkerend',
  warning: 'Ter beoordeling',
  note: 'Ter info',
}

function PurchaseInvoiceScreen() {
  const { invoice } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [disputing, setDisputing] = useState(false)
  const key = useRef<string>(crypto.randomUUID())

  if (!invoice.ok) {
    return (
      <>
        <PageHeader title="Inkoopfactuur" />
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
        title={`${data.kind === 'credit_note' ? 'Creditnota' : 'Inkoopfactuur'} ${data.supplierInvoiceNumber}`}
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
                {busy ? 'Bezig…' : 'Boeken'}
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
                {busy ? 'Bezig…' : 'Goedkeuren voor betaling'}
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
                In geschil zetten
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
                Geschil opgelost
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
                Laten vervallen
              </button>
            )}
            <Link to="/purchases" className="text-sm underline">
              Alle facturen
            </Link>
          </div>
        }
      />

      <div className="mb-8 flex flex-wrap gap-8">
        <Stat label="Excl. btw" value={<Money amount={data.net} />} />
        <Stat label="Btw" value={<Money amount={data.tax} />} />
        <Stat label="Totaal" value={<Money amount={data.total} />} />
        <Stat
          label="Openstaand"
          value={<Money amount={data.outstanding} />}
          hint={data.outstanding === '0' ? 'betaald' : `vervalt ${formatDate(data.dueDate)}`}
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
              Waarom is deze factuur in geschil?
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
            Dit is wat de leverancier te horen krijgt en wat de volgende persoon leest. De factuur
            blijft geboekt — de schuld bestaat tot hij is voldaan of gecrediteerd — maar wordt niet
            betaald.
          </p>
          <button
            type="submit"
            disabled={!hydrated || busy}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            In geschil zetten
          </button>
        </form>
      )}

      {data.disputedReason !== null && (
        <p className="border-destructive mb-8 max-w-2xl rounded-md border p-3 text-sm">
          <strong className="font-medium">In geschil:</strong> {data.disputedReason}
        </p>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="text-destructive mb-6 max-w-2xl space-y-1 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 text-sm font-semibold">Regels</h2>
      <table className="border-border mb-8 w-full max-w-4xl border-collapse text-sm">
        <caption className="sr-only">Regels van deze inkoopfactuur</caption>
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-2 font-medium">
              Omschrijving
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              Grootboek
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              Btw-code
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Excl. btw
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Btw
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
            Bevindingen{blocking.length > 0 && ` (${String(blocking.length)} blokkerend)`}
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
                  {SEVERITY_LABEL[finding.severity] ?? finding.severity}:{' '}
                  {FINDING_LABEL[finding.code] ?? finding.code}
                  {finding.lineNumber !== null && ` (regel ${String(finding.lineNumber)})`}
                </p>
                <p className="text-muted-foreground mt-1">{finding.message}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.journalEntryId !== null && (
        <p className="text-sm">
          Geboekt als{' '}
          <Link
            to="/entries/$entryId"
            params={{ entryId: data.journalEntryId }}
            className="underline"
          >
            journaalpost {data.journalEntryNumber ?? ''}
          </Link>
          {data.approvedBy !== null && ' · goedgekeurd voor betaling'}
          {data.payableRefusal !== null && (
            <span className="text-muted-foreground"> · {data.payableRefusal}</span>
          )}
        </p>
      )}
    </>
  )
}
