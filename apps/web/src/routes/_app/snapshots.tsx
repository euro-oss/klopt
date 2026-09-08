import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { listSnapshots, sealSnapshot, verifySnapshot } from '~/server/ledger'

/**
 * Verzegelde momentopnames — the "prove nothing changed" artefact (spec 7.6).
 *
 * The screen shows the seal prominently and in full, because the seal is the
 * thing somebody is meant to take away: written down, emailed to an accountant,
 * read out over the phone. Truncating it to look tidy would defeat the point.
 *
 * "Controleren" writes down what it found, so "we checked this in March" is
 * provable — which is the same problem the snapshot itself exists to solve.
 */
export const Route = createFileRoute('/_app/snapshots')({
  loader: async () => ({ snapshots: await listSnapshots() }),
  component: Snapshots,
})

const DRIFT_LABEL: Record<string, string> = {
  seal_broken: 'zegel klopt niet met het manifest',
  chain_head_changed: 'journaalpost herschreven',
  entry_count_fell: 'journaalposten verdwenen',
  audit_file_changed: 'auditfile exporteert anders',
  document_missing: 'document verdwenen',
  document_changed: 'document veranderd',
  document_undeleted: 'verwijderd document is terug',
}

function formatBytes(size: string): string {
  const value = Number(size)
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function Snapshots() {
  const { snapshots } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())

  if (!snapshots.ok) {
    return (
      <>
        <PageHeader title="Verzegelde momentopnames" />
        <p role="alert" className="text-destructive text-sm">
          {snapshots.problem.detail}
        </p>
      </>
    )
  }

  const rows = snapshots.data.snapshots

  async function act(work: () => Promise<{ ok: boolean; problem?: { detail: string } }>) {
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
    await router.invalidate()
    return result
  }

  return (
    <>
      <PageHeader
        title="Verzegelde momentopnames"
        description="Een boekjaar onder één hash: de kop van de hashketen, een manifest van documenthashes en de auditfile. Klein genoeg om op te schrijven, genoeg om een wijziging in zeven jaar boekhouding aan te tonen."
        actions={
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const field = new FormData(event.currentTarget).get('fiscalYear')
              const year = typeof field === 'string' ? field.trim() : ''
              void act(() =>
                sealSnapshot({ data: { idempotencyKey: key.current, fiscalYear: year } }),
              )
            }}
          >
            <label>
              <span className="sr-only">Boekjaar</span>
              <input
                name="fiscalYear"
                required
                inputMode="numeric"
                maxLength={4}
                placeholder={String(new Date().getFullYear())}
                className="border-input bg-background w-24 rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={!hydrated || busy}
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Bezig…' : 'Verzegelen'}
            </button>
          </form>
        }
      />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label="Momentopnames" value={String(rows.length)} />
        <Stat
          label="Gecontroleerd"
          value={String(rows.filter((row) => row.verifiedAt !== null).length)}
        />
        <Stat
          label="Afwijkingen"
          value={String(rows.filter((row) => row.verifiedOk === false).length)}
          tone={rows.some((row) => row.verifiedOk === false) ? 'warn' : 'neutral'}
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}
      {note !== null && <p className="mb-4 text-sm">{note}</p>}

      {rows.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-sm">
          Nog geen momentopnames. De werker verzegelt elk boekjaar met posten dat er nog geen heeft;
          hierboven kan het ook met de hand.
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.id} className="border-border rounded-md border p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-sm font-semibold">Boekjaar {row.fiscalYear}</h2>
                <span className="text-muted-foreground tabular text-xs">
                  {formatDate(row.sealedAt.slice(0, 10))} · {row.sealedBy}
                </span>
                {row.verifiedAt !== null && (
                  <span
                    className={
                      row.verifiedOk === true ? 'text-xs' : 'text-destructive text-xs font-medium'
                    }
                  >
                    {row.verifiedOk === true
                      ? `gecontroleerd op ${formatDate(row.verifiedAt.slice(0, 10))}`
                      : 'afwijking gevonden'}
                  </span>
                )}
              </div>

              {/*
                In full, and monospaced. This is the value somebody writes down
                or reads out; truncating it to look tidy would defeat the point.
              */}
              <p className="mb-3 font-mono text-xs break-all">
                <span className="text-muted-foreground">zegel </span>
                {row.seal}
              </p>

              <dl className="text-muted-foreground mb-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt>Journaalposten</dt>
                  <dd className="tabular">{row.entryCount}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>Documenten</dt>
                  <dd className="tabular">
                    {row.documentCount}
                    {row.deletedDocumentCount > 0 &&
                      ` (${String(row.deletedDocumentCount)} verwijderd)`}
                    {' · '}
                    {formatBytes(row.totalBytes)}
                  </dd>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <dt>Ketenkop</dt>
                  <dd className="font-mono break-all">{row.chainHead ?? '—'}</dd>
                </div>
                {row.previousSeal !== null && (
                  <div className="flex gap-2 sm:col-span-2">
                    <dt>Vorige zegel</dt>
                    <dd className="font-mono break-all">{row.previousSeal}</dd>
                  </div>
                )}
              </dl>

              {row.drift !== null && row.drift.length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {row.drift.map((entry) => (
                    <li key={`${entry.code}-${entry.expected ?? ''}`} className="text-destructive">
                      <span className="font-medium">{DRIFT_LABEL[entry.code] ?? entry.code}</span> —{' '}
                      {entry.detail}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!hydrated || busy}
                  onClick={() => {
                    void act(() => verifySnapshot({ data: { snapshotId: row.id } }))
                  }}
                  className="border-border rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Controleren
                </button>
                <button
                  type="button"
                  disabled={!hydrated || busy}
                  onClick={() => {
                    void act(() =>
                      verifySnapshot({ data: { snapshotId: row.id, recomputeAuditFile: true } }),
                    )
                  }}
                  className="border-border rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Controleren met auditfile
                </button>
                <a
                  href={`/api/v1/snapshots/${row.id}/manifest`}
                  className="text-primary self-center text-sm underline"
                >
                  Manifest
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
