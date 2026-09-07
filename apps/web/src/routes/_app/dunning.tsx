import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { Money } from '~/components/finance/money'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { dunningQueue, sendReminder } from '~/server/sales'

/**
 * Aanmaningen — who to chase today, and with which letter.
 *
 * The list is one row per invoice, never one per overdue stage: an invoice two
 * months late gets the final demand, not three letters in three days. Which
 * letter that is comes from the invoice's age and what has already been sent,
 * computed on the server — the button only says "send the one you told me
 * about", and a mismatch is refused rather than sending the wrong thing.
 *
 * Until payments land in M2, "overdue" means issued and not cancelled. That
 * overstates the list for anyone who has been paid, and it is the honest
 * reading of what this system currently knows.
 */
export const Route = createFileRoute('/_app/dunning')({
  loader: async () => ({ queue: await dunningQueue({ data: {} }) }),
  component: Dunning,
})

const TONE_CLASS: Record<string, string> = {
  reminder: 'text-muted-foreground',
  demand: 'text-foreground',
  final: 'text-unreconciled',
}

function Dunning() {
  const { queue } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const keys = useRef<Map<string, string>>(new Map())

  if (!queue.ok) {
    return (
      <>
        <PageHeader title="Aanmaningen" />
        <p role="alert" className="text-destructive text-sm">
          {queue.problem.detail}
        </p>
      </>
    )
  }

  const { actions, totalOverdue, asOf, schedule } = queue.data

  async function chase(invoiceId: string, stage: number, name: string) {
    // One key per invoice, held until that invoice's reminder goes out, so a
    // double click sends one letter.
    if (!keys.current.has(invoiceId)) keys.current.set(invoiceId, crypto.randomUUID())

    setBusy(invoiceId)
    setError(null)
    setNotice(null)

    const result = await sendReminder({
      data: {
        invoiceId,
        idempotencyKey: keys.current.get(invoiceId) ?? crypto.randomUUID(),
        expectedStage: stage,
        asOf,
      },
    })

    setBusy(null)

    if (!result.ok) {
      setError(result.problem.detail)
      return
    }

    keys.current.delete(invoiceId)
    setNotice(
      result.data.failure === null
        ? `${result.data.stageLabel} verstuurd naar ${name}.`
        : `Versturen naar ${name} mislukt: ${result.data.failure}`,
    )
    await router.invalidate()
  }

  return (
    <>
      <PageHeader
        title="Aanmaningen"
        description={`Openstaande facturen per ${formatDate(asOf)}, met de herinnering die elk nu verdient.`}
      />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat
          label="Te chasen"
          value={String(actions.length)}
          hint="facturen met een openstaande herinnering"
        />
        <Stat
          label="Openstaand bedrag"
          value={<Money amount={totalOverdue} />}
          tone={BigInt(totalOverdue) > 0n ? 'warn' : 'neutral'}
          hint="van de facturen in deze lijst"
        />
        <Stat
          label="Schema"
          value={schedule.map((stage) => `${String(stage.afterDays)}d`).join(' · ')}
          hint={schedule.map((stage) => stage.label).join(', ')}
        />
      </div>

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

      {actions.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-sm">
          Niets te chasen. Elke openstaande factuur is nog op tijd, of is al aangemaand.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th className="py-2 font-medium">Factuur</th>
              <th className="py-2 font-medium">Relatie</th>
              <th className="py-2 font-medium">Vervallen</th>
              <th className="py-2 text-right font-medium">Dagen</th>
              <th className="py-2 text-right font-medium">Bedrag</th>
              <th className="py-2 font-medium">Volgende stap</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => (
              <tr key={action.invoiceId} className="border-border border-b">
                <td className="tabular py-2">
                  <Link
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: action.invoiceId }}
                    className="underline"
                  >
                    {action.number}
                  </Link>
                </td>
                <td className="py-2">
                  {action.contactName}
                  {!action.sendable && (
                    <span className="text-unreconciled"> · geen e-mailadres</span>
                  )}
                </td>
                <td className="tabular py-2">{formatDate(action.dueDate)}</td>
                <td className="tabular py-2 text-right">{action.daysOverdue}</td>
                <td className="py-2 text-right">
                  <Money amount={action.total} />
                </td>
                <td className={`py-2 ${TONE_CLASS[action.tone] ?? ''}`}>{action.stageLabel}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    disabled={busy !== null || !hydrated || !action.sendable}
                    onClick={() => {
                      void chase(action.invoiceId, action.stage, action.contactName)
                    }}
                    className="border-input rounded-md border px-3 py-1 text-xs disabled:opacity-50"
                  >
                    {busy === action.invoiceId ? 'Bezig…' : 'Versturen'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-muted-foreground mt-6 max-w-2xl text-xs">
        Betalingen worden nog niet bijgehouden, dus &ldquo;openstaand&rdquo; betekent hier verstuurd
        en niet vervallen. Een factuur die al betaald is, staat er dus ook in.
      </p>
    </>
  )
}
