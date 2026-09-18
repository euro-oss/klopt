import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { getReportYear } from '~/server/fiscal-year'
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
  // The year to seal is offered from the administration's own book years, not
  // from the clock: an administration whose boekjaar runs July to June has
  // nothing to seal for the calendar year, and a placeholder that says
  // otherwise is a wrong answer in a box that looks helpful.
  loader: async () => ({ snapshots: await listSnapshots(), year: await getReportYear() }),
  component: Snapshots,
})

const DRIFT_KEY: Record<string, MessageKey> = {
  seal_broken: 'snapshots.drift.seal_broken',
  chain_head_changed: 'snapshots.drift.chain_head_changed',
  entry_count_fell: 'snapshots.drift.entry_count_fell',
  audit_file_changed: 'snapshots.drift.audit_file_changed',
  document_missing: 'snapshots.drift.document_missing',
  document_changed: 'snapshots.drift.document_changed',
  document_undeleted: 'snapshots.drift.document_undeleted',
}

function formatBytes(size: string): string {
  const value = Number(size)
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function Snapshots() {
  const { snapshots, year } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()

  const { t } = useT()

  /** An unrecognised drift code is shown raw rather than as a blank. */
  const driftOf = (code: string) => {
    const key = DRIFT_KEY[code]
    return key === undefined ? code : t(key)
  }

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())

  if (!snapshots.ok) {
    return (
      <>
        <PageHeader title={t('snapshots.title')} />
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
      setError(result.problem?.detail ?? t('snapshots.failed'))
      return null
    }

    key.current = crypto.randomUUID()
    await router.invalidate()
    return result
  }

  return (
    <>
      <PageHeader
        title={t('snapshots.title')}
        description={t('snapshots.intro')}
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
              {/* Named for what it does, not just "Boekjaar": the shell has a
                  book-year control of its own now, and a screen reader
                  announcing two fields with the same name on one page cannot
                  say which one seals a year. */}
              <span className="sr-only">{t('snapshots.yearToSeal')}</span>
              <input
                name="fiscalYear"
                required
                inputMode="numeric"
                maxLength={4}
                defaultValue={year.ok ? year.data.scope.code : ''}
                placeholder={year.ok ? year.data.scope.code : ''}
                className="border-input bg-background w-24 rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={!hydrated || busy}
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? t('common.busy') : t('snapshots.seal')}
            </button>
          </form>
        }
      />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label={t('snapshots.count')} value={String(rows.length)} />
        <Stat
          label={t('snapshots.checked')}
          value={String(rows.filter((row) => row.verifiedAt !== null).length)}
        />
        <Stat
          label={t('snapshots.drifted')}
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
          {t('snapshots.empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.id} className="border-border rounded-md border p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-sm font-semibold">
                  {t('snapshots.bookYear', { year: row.fiscalYear })}
                </h2>
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
                      ? t('snapshots.checkedOn', { date: formatDate(row.verifiedAt.slice(0, 10)) })
                      : t('snapshots.driftFound')}
                  </span>
                )}
              </div>

              {/*
                In full, and monospaced. This is the value somebody writes down
                or reads out; truncating it to look tidy would defeat the point.
              */}
              <p className="mb-3 tabular text-xs break-all">
                <span className="text-muted-foreground">{t('snapshots.sealLabel')}</span>
                {row.seal}
              </p>

              <dl className="text-muted-foreground mb-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt>{t('snapshots.entries')}</dt>
                  <dd className="tabular">{row.entryCount}</dd>
                </div>
                <div className="flex gap-2">
                  <dt>{t('snapshots.documents')}</dt>
                  <dd className="tabular">
                    {row.documentCount}
                    {row.deletedDocumentCount > 0 &&
                      t('snapshots.deletedCount', { count: String(row.deletedDocumentCount) })}
                    {' · '}
                    {formatBytes(row.totalBytes)}
                  </dd>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <dt>{t('snapshots.chainHead')}</dt>
                  <dd className="tabular break-all">{row.chainHead ?? '—'}</dd>
                </div>
                {row.previousSeal !== null && (
                  <div className="flex gap-2 sm:col-span-2">
                    <dt>{t('snapshots.previousSeal')}</dt>
                    <dd className="tabular break-all">{row.previousSeal}</dd>
                  </div>
                )}
              </dl>

              {row.drift !== null && row.drift.length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {row.drift.map((entry) => (
                    <li key={`${entry.code}-${entry.expected ?? ''}`} className="text-destructive">
                      <span className="font-medium">{driftOf(entry.code)}</span> — {entry.detail}
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
                  {t('snapshots.verify')}
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
                  {t('snapshots.verifyWithAuditFile')}
                </button>
                <a
                  href={`/api/v1/snapshots/${row.id}/manifest`}
                  className="text-primary self-center text-sm underline"
                >
                  {t('snapshots.manifest')}
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
