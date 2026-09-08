import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { deleteDocuments, getRetention, setLegalHold, setRetentionClass } from '~/server/ledger'

/**
 * Bewaarplicht — what is kept how long, and what may go (spec 7.6).
 *
 * The screen is mostly a preview, because the spec is emphatic that deletion is
 * "a deliberate, audited, permissioned batch action with a preview. Never
 * automatic." So there is no sweep, no scheduled job and no default selection:
 * the operator picks, types a reason, and presses a button that says what it
 * will do.
 *
 * Every state is counted, not only the deletable one. Somebody wondering why
 * nothing can be deleted needs an answer, and "0 documenten" is not one.
 */
export const Route = createFileRoute('/_app/retention')({
  loader: async () => ({ retention: await getRetention({ data: {} }) }),
  component: Retention,
})

const STATE_LABEL: Record<string, string> = {
  expired: 'termijn verlopen',
  retained: 'bewaren',
  held: 'legal hold',
  undated: 'geen boekjaar',
  deleted: 'verwijderd',
}

function formatBytes(size: bigint | number): string {
  const value = Number(size)
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function Retention() {
  const { retention } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [reason, setReason] = useState('')
  const key = useRef(crypto.randomUUID())

  if (!retention.ok) {
    return (
      <>
        <PageHeader title="Bewaarplicht" />
        <p role="alert" className="text-destructive text-sm">
          {retention.problem.detail}
        </p>
      </>
    )
  }

  const data = retention.data
  const documents = data.documents

  const toggle = (id: string) => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function run<T>(work: () => Promise<{ ok: boolean; problem?: { detail: string } }>) {
    setBusy(true)
    setError(null)
    setNote(null)
    const result = await work()
    setBusy(false)

    if (!result.ok) {
      setError(result.problem?.detail ?? 'Dat is niet gelukt.')
      return null
    }

    key.current = crypto.randomUUID()
    setChosen(new Set())
    setReason('')
    await router.invalidate()
    return result as T
  }

  const deletable = documents.filter((row) => row.deletable)
  const chosenDeletable = [...chosen].filter((id) => deletable.some((row) => row.id === id))

  return (
    <>
      <PageHeader
        title="Bewaarplicht"
        description="Zeven jaar, tien voor onroerend goed, gerekend vanaf het einde van het boekjaar waar een document bij hoort. Verwijderen gebeurt nooit automatisch."
      />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label="Documenten" value={String(data.summary.documents)} />
        <Stat
          label="Termijn verlopen"
          value={String(data.summary.byState.expired)}
          tone={data.summary.byState.expired > 0 ? 'warn' : 'neutral'}
        />
        <Stat label="Legal hold" value={String(data.summary.byState.held)} />
        <Stat label="Geen boekjaar" value={String(data.summary.byState.undated)} />
        <Stat label="Vrij te maken" value={formatBytes(BigInt(data.summary.deletableBytes))} />
      </div>

      {/*
        What the storage guarantees, not what we would like it to. Spec 7.6 asks
        for object lock; a directory has none, and saying so on a compliance
        screen is the whole difference between a claim and a fact.
      */}
      {data.storage.note !== null && (
        <p className="border-border text-muted-foreground mb-6 max-w-3xl rounded-md border border-dashed p-3 text-sm">
          <span className="font-medium">Opslag: {data.storage.name}.</span> {data.storage.note}
        </p>
      )}

      <section className="border-border mb-8 max-w-3xl rounded-md border p-4">
        <h2 className="mb-1 text-sm font-semibold">Legal hold op de hele administratie</h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Schort verwijderen op, ongeacht de bewaartermijn. Een geschil of een boekenonderzoek duurt
          langer dan de termijn, en dan moet de klok niet meer uitmaken.
        </p>

        {data.legalHold.held ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              <span className="font-medium">Aan</span>
              {data.legalHold.reason !== null && ` — ${data.legalHold.reason}`}
            </p>
            <button
              type="button"
              disabled={!hydrated || busy}
              onClick={() => {
                void run(() =>
                  setLegalHold({
                    data: {
                      idempotencyKey: key.current,
                      scope: 'entity',
                      held: false,
                      documentIds: [],
                      reason: null,
                    },
                  }),
                )
              }}
              className="border-border rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Opheffen
            </button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const field = new FormData(event.currentTarget).get('reason')
              const why = typeof field === 'string' ? field.trim() : ''
              void run(() =>
                setLegalHold({
                  data: {
                    idempotencyKey: key.current,
                    scope: 'entity',
                    held: true,
                    documentIds: [],
                    reason: why,
                  },
                }),
              )
            }}
          >
            <label className="grow">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">Waarom</span>
              <input
                name="reason"
                required
                placeholder="Boekenonderzoek Belastingdienst"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={!hydrated || busy}
              className="border-border rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              Instellen
            </button>
          </form>
        )}
      </section>

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}
      {note !== null && <p className="mb-4 text-sm">{note}</p>}

      {documents.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-sm">
          Nog geen documenten.
        </p>
      ) : (
        <>
          <table className="mb-4 w-full text-sm">
            <caption className="sr-only">Documenten en hun bewaartermijn</caption>
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th scope="col" className="w-8" />
                <th scope="col">Document</th>
                <th scope="col">Boekjaar</th>
                <th scope="col">Bewaren tot</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">
                  Grootte
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((row) => (
                <tr key={row.id} className="border-border/50 border-t align-top">
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Selecteer ${row.filename ?? row.sha256.slice(0, 12)}`}
                      checked={chosen.has(row.id)}
                      disabled={!hydrated || row.state === 'deleted'}
                      onChange={() => {
                        toggle(row.id)
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    {row.filename ?? <span className="text-muted-foreground">naamloos</span>}
                    <span className="text-muted-foreground block text-xs">
                      {row.contentType} ·{' '}
                      {row.linkCount === 0
                        ? 'nog niet gekoppeld'
                        : `${String(row.linkCount)}× gekoppeld`}
                    </span>
                  </td>
                  <td className="tabular py-1.5 pr-2 text-xs">{row.retentionFiscalYear ?? '—'}</td>
                  <td className="tabular py-1.5 pr-2 text-xs">
                    {row.retainUntil === null ? '—' : formatDate(row.retainUntil)}
                    <span className="text-muted-foreground block">{row.retentionClassLabel}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-xs">
                    <span className={row.state === 'expired' ? 'text-unreconciled' : undefined}>
                      {STATE_LABEL[row.state]}
                    </span>
                    <span className="text-muted-foreground block">{row.reason}</span>
                  </td>
                  <td className="tabular py-1.5 text-right text-xs">
                    {formatBytes(row.sizeBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-border flex flex-wrap items-end gap-3 rounded-md border p-4">
            <p className="text-muted-foreground w-full text-sm">
              {chosen.size === 0
                ? 'Selecteer documenten om ze op hold te zetten, als onroerend goed te merken, of te verwijderen als de termijn voorbij is.'
                : `${String(chosen.size)} geselecteerd, waarvan ${String(chosenDeletable.length)} met verlopen termijn.`}
            </p>

            <button
              type="button"
              disabled={!hydrated || busy || chosen.size === 0}
              onClick={() => {
                void run(() =>
                  setRetentionClass({
                    data: {
                      idempotencyKey: key.current,
                      documentIds: [...chosen],
                      retentionClass: 'immovable_property',
                    },
                  }),
                )
              }}
              className="border-border rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              Tien jaar (onroerend goed)
            </button>

            <label className="grow">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                Reden — verplicht bij hold en bij verwijderen
              </span>
              <input
                value={reason}
                onChange={(event) => {
                  setReason(event.currentTarget.value)
                }}
                placeholder="Bewaartermijn 2018 verlopen"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>

            <button
              type="button"
              disabled={!hydrated || busy || chosen.size === 0 || reason.trim() === ''}
              onClick={() => {
                void run(() =>
                  setLegalHold({
                    data: {
                      idempotencyKey: key.current,
                      scope: 'documents',
                      held: true,
                      documentIds: [...chosen],
                      reason: reason.trim(),
                    },
                  }),
                )
              }}
              className="border-border rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              Op hold zetten
            </button>

            {/*
              Disabled unless every selected document is actually deletable. The
              handler refuses a mixed batch by name anyway — the policy decides,
              not the screen — but offering a button that will be refused is
              worse than not offering it.
            */}
            <button
              type="button"
              disabled={
                !hydrated ||
                busy ||
                chosen.size === 0 ||
                reason.trim() === '' ||
                chosenDeletable.length !== chosen.size
              }
              onClick={() => {
                void run(() =>
                  deleteDocuments({
                    data: {
                      idempotencyKey: key.current,
                      documentIds: [...chosen],
                      reason: reason.trim(),
                    },
                  }),
                )
              }}
              className="bg-destructive text-destructive-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Bezig…' : `Definitief verwijderen (${String(chosenDeletable.length)})`}
            </button>
          </div>
        </>
      )}
    </>
  )
}
