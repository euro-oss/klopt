import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { LedgerTable, type Column } from '~/components/finance/ledger-table'
import { Money } from '~/components/finance/money'
import { formatDate, parseMinorUnits } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { getSession } from '~/server/context'
import {
  addPaymentInstruction,
  getPaymentBatch,
  removePaymentInstruction,
  transitionPaymentBatch,
} from '~/server/payments'
import { STATE_LABEL } from './payments.index'

/**
 * One payment batch.
 *
 * The screen's job is to say **who has to do what next, and whether that is
 * you** — because the control this flow exists for only works if the two people
 * can see their halves. So a batch you submitted yourself says so, in words,
 * instead of offering an approve button that fails when pressed.
 *
 * Everything a batch is wrong about is listed rather than summarised. An
 * approver reading "1 problem" has to go and find it; an approver reading
 * "NL91ABNA0417164301 is not a valid IBAN" already knows.
 */
export const Route = createFileRoute('/_app/payments/$batchId')({
  loader: async ({ params }) => ({
    batch: await getPaymentBatch({ data: { batchId: params.batchId } }),
    session: await getSession(),
  }),
  component: PaymentBatch,
})

interface Instruction {
  id: string
  endToEndId: string
  creditorName: string
  creditorIban: string
  creditorBic: string | null
  amount: string
  currency: string
  remittanceInformation: string
  remittanceReference: string | null
}

function PaymentBatch() {
  const { batch: loaded, session } = Route.useLoaderData()
  const { batchId } = Route.useParams()
  const router = useRouter()
  const hydrated = useHydrated()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const addKey = useRef<string>(crypto.randomUUID())

  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Betaalbatch" />
        <p role="alert" className="text-destructive text-sm">
          {loaded.problem.detail}
        </p>
      </>
    )
  }

  const { batch, problems, payable } = loaded.data
  const me = session?.user.id ?? null
  /**
   * The two-person rule, shown rather than discovered.
   *
   * The API refuses this too — it is the domain's rule, checked against the
   * database — but a button that fails when pressed teaches nothing about why.
   */
  const iSubmitted = batch.submittedBy !== null && batch.submittedBy === me

  async function act(
    action: 'submit' | 'approve' | 'reject' | 'reopen' | 'export',
    reason: string | null = null,
  ) {
    setBusy(true)
    setError(null)
    setNotice(null)

    const result = await transitionPaymentBatch({
      data: { batchId, idempotencyKey: crypto.randomUUID(), action, reason },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => item.message).join(' ')
          : result.problem.detail,
      )
      return
    }

    setNotice(`Status is nu: ${STATE_LABEL[result.data.state]}.`)
    await router.invalidate()
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Captured before the first `await`: React nulls a synthetic event's
    // `currentTarget` once the handler returns, so reaching for it afterwards
    // throws — which is what it did, silently, leaving the form looking as
    // though the submit had done nothing.
    const element = event.currentTarget
    const form = new FormData(element)
    const text = (name: string): string => {
      const value = form.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }

    setBusy(true)
    setError(null)

    const result = await addPaymentInstruction({
      data: {
        batchId,
        idempotencyKey: addKey.current,
        body: {
          endToEndId: text('endToEndId'),
          creditorName: text('creditorName'),
          creditorIban: text('creditorIban'),
          creditorBic: text('creditorBic') === '' ? null : text('creditorBic'),
          // Typed the way a bookkeeper types it — `1.234,56` — and parsed by
          // the same reader every other amount field uses.
          amount: (parseMinorUnits(text('amount')) ?? 0n).toString(),
          remittanceInformation: text('remittanceInformation'),
          remittanceReference:
            text('remittanceReference') === '' ? null : text('remittanceReference'),
        },
      },
    })
    setBusy(false)

    if (!result.ok) {
      setError(
        result.problem.violations.length > 0
          ? result.problem.violations.map((item) => item.message).join(' ')
          : result.problem.detail,
      )
      return
    }

    addKey.current = crypto.randomUUID()
    element.reset()
    await router.invalidate()
  }

  async function remove(instructionId: string) {
    setBusy(true)
    setError(null)
    const result = await removePaymentInstruction({
      data: { batchId, instructionId, idempotencyKey: crypto.randomUUID() },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.problem.detail)
      return
    }
    await router.invalidate()
  }

  const columns: readonly Column<Instruction>[] = [
    { key: 'name', header: 'Begunstigde', cell: (row) => row.creditorName },
    {
      key: 'iban',
      header: 'IBAN',
      width: '15rem',
      cell: (row) => <span className="tabular text-xs">{row.creditorIban}</span>,
    },
    {
      key: 'reference',
      header: 'Kenmerk',
      width: '11rem',
      cell: (row) => <span className="text-xs">{row.remittanceReference ?? row.endToEndId}</span>,
    },
    {
      key: 'description',
      header: 'Omschrijving',
      cell: (row) => <span className="text-xs">{row.remittanceInformation}</span>,
    },
    {
      key: 'amount',
      header: 'Bedrag',
      width: '9rem',
      align: 'right',
      cell: (row) => <Money amount={row.amount} />,
    },
    ...(batch.editable
      ? [
          {
            key: 'remove',
            header: '',
            width: '5rem',
            align: 'right' as const,
            cell: (row: Instruction) => (
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void remove(row.id)
                }}
                className="text-muted-foreground hover:text-destructive text-xs underline disabled:opacity-50"
              >
                Weg
              </button>
            ),
          },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title={`Betaalbatch ${batch.reference}`}
        description={`${batch.debtorIban} · uitvoerdatum ${formatDate(batch.requestedExecutionDate)} · ${STATE_LABEL[batch.state]}`}
        actions={
          <>
            {batch.state === 'draft' && (
              <button
                type="button"
                disabled={busy || !hydrated || !payable}
                onClick={() => {
                  void act('submit')
                }}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Ter fiattering aanbieden
              </button>
            )}
            {batch.state === 'submitted' && !iSubmitted && (
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void act('approve')
                }}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Fiatteren
              </button>
            )}
            {batch.state === 'submitted' && (
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void act('reject', 'afgekeurd')
                }}
                className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                Afkeuren
              </button>
            )}
            {batch.state === 'rejected' && (
              <button
                type="button"
                disabled={busy || !hydrated}
                onClick={() => {
                  void act('reopen')
                }}
                className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              >
                Weer openen
              </button>
            )}
            {(batch.state === 'approved' || batch.state === 'exported') && (
              <>
                <a
                  href={`/api/v1/payment-batches/${batchId}/pain001`}
                  className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
                >
                  Bestand downloaden
                </a>
                {batch.state === 'approved' && (
                  <button
                    type="button"
                    disabled={busy || !hydrated}
                    onClick={() => {
                      void act('export')
                    }}
                    className="border-input rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                  >
                    Markeren als verstuurd
                  </button>
                )}
              </>
            )}
            <Link to="/payments" className="border-input rounded-md border px-4 py-2 text-sm">
              Terug
            </Link>
          </>
        }
      />

      {batch.state === 'submitted' && iSubmitted && (
        <p className="border-border text-muted-foreground mb-4 rounded-md border p-3 text-sm">
          Je hebt deze batch zelf klaargezet, dus iemand anders moet hem fiatteren. Dat is niet een
          instelling — het is de hele bedoeling van twee paar ogen.
        </p>
      )}

      {batch.state === 'submitted' && !iSubmitted && (
        <p className="border-border mb-4 rounded-md border p-3 text-sm">
          Controleer de regels hieronder. Na fiattering staat de batch vast en kan er alleen nog een
          nieuwe komen.
        </p>
      )}

      {notice !== null && (
        <p className="border-border text-muted-foreground mb-4 rounded-md border p-3 text-sm">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="text-destructive mb-4 space-y-1 text-sm">
          {problems.map((problem, index) => (
            <li key={index}>
              {problem.path}: {problem.message}
            </li>
          ))}
        </ul>
      )}

      <LedgerTable
        columns={columns}
        rows={batch.instructions}
        rowKey={(row) => row.id}
        caption="Betaalregels"
        empty="Nog geen regels. Een batch die niemand betaalt kan niet worden aangeboden."
        footer={
          <tr>
            <td colSpan={columns.length - 1} className="py-2 text-right text-sm font-medium">
              Totaal
            </td>
            <td className="py-2 text-right">
              <Money amount={batch.total} className="font-medium" />
            </td>
          </tr>
        }
      />

      {batch.editable && (
        <>
          <button
            type="button"
            disabled={!hydrated}
            onClick={() => {
              setOpen((value) => !value)
            }}
            className="border-input mt-6 rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            {open ? 'Annuleren' : 'Betaling toevoegen'}
          </button>

          {open && (
            <form
              onSubmit={(event) => {
                void add(event)
              }}
              className="border-border mt-4 max-w-4xl space-y-4 rounded-md border p-4"
            >
              <div className="grid grid-cols-3 gap-4">
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    Begunstigde
                  </span>
                  <input
                    name="creditorName"
                    required
                    maxLength={70}
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">IBAN</span>
                  <input
                    name="creditorIban"
                    required
                    placeholder="NL20INGB0001234567"
                    className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    BIC <span className="opacity-70">(optioneel)</span>
                  </span>
                  <input
                    name="creditorBic"
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    Bedrag
                  </span>
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder="45,50"
                    className="border-input bg-background tabular w-full rounded-md border px-3 py-2 text-right text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    Eigen kenmerk
                  </span>
                  <input
                    name="endToEndId"
                    required
                    maxLength={35}
                    placeholder="INK-2026-0007"
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    Omschrijving
                  </span>
                  <input
                    name="remittanceInformation"
                    maxLength={140}
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    Betalingskenmerk
                  </span>
                  <input
                    name="remittanceReference"
                    maxLength={35}
                    className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={busy || !hydrated}
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Toevoegen
              </button>
            </form>
          )}
        </>
      )}

      {batch.exportedHash !== null && (
        <p className="text-muted-foreground mt-6 text-xs">
          Verstuurd bestand: <span className="font-mono">{batch.exportedHash.slice(0, 16)}…</span> —
          de hash van precies die bytes, zodat later te controleren is wat de bank kreeg.
        </p>
      )}
    </>
  )
}
