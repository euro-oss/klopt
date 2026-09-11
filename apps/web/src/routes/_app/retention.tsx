import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader, Stat } from '~/components/app-shell'
import { formatDate } from '~/lib/format'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
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

const STATE_KEY: Record<string, MessageKey> = {
  expired: 'retention.state.expired',
  retained: 'retention.state.retained',
  held: 'retention.state.held',
  undated: 'retention.state.undated',
  deleted: 'retention.state.deleted',
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

  const { t } = useT()

  /** An unrecognised state is shown raw rather than as a blank. */
  const stateOf = (state: string) => {
    const key = STATE_KEY[state]
    return key === undefined ? state : t(key)
  }

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [reason, setReason] = useState('')
  const key = useRef(crypto.randomUUID())

  if (!retention.ok) {
    return (
      <>
        <PageHeader title={t('retention.title')} />
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
      setError(result.problem?.detail ?? t('retention.failed'))
      return null
    }

    key.current = crypto.randomUUID()
    setChosen(new Set())
    setReason('')

    // A store that refused is the store working. Saying nothing would leave
    // somebody believing bytes were destroyed that are still sitting there.
    const outcome = result as { data?: { refusedByStorage?: readonly unknown[] } }
    const refused = outcome.data?.refusedByStorage?.length ?? 0
    if (refused > 0) {
      setNote(
        `${String(refused)} document(en) zijn in de administratie afgevoerd, maar de opslag houdt de bytes nog vast onder een object lock. Dat is de opslag die zijn werk doet, niet een fout.`,
      )
    }

    await router.invalidate()
    return result as T
  }

  const deletable = documents.filter((row) => row.deletable)
  const chosenDeletable = [...chosen].filter((id) => deletable.some((row) => row.id === id))

  return (
    <>
      <PageHeader title={t('retention.title')} description={t('retention.intro')} />

      <div className="mb-6 flex flex-wrap gap-8">
        <Stat label={t('retention.documents')} value={String(data.summary.documents)} />
        <Stat
          label={t('retention.expired')}
          value={String(data.summary.byState.expired)}
          tone={data.summary.byState.expired > 0 ? 'warn' : 'neutral'}
        />
        <Stat label={t('retention.legalHold')} value={String(data.summary.byState.held)} />
        <Stat label={t('retention.undated')} value={String(data.summary.byState.undated)} />
        <Stat
          label={t('retention.freeable')}
          value={formatBytes(BigInt(data.summary.deletableBytes))}
        />
      </div>

      {/*
        What the storage guarantees, not what we would like it to. Spec 7.6 asks
        for object lock; a directory has none, and saying so on a compliance
        screen is the whole difference between a claim and a fact.

        `vastgehouden` versus `met termijn` is the honest middle state: a
        document whose term is known but which the store has not been told about
        yet is protected by the application and not by the storage.
      */}
      <p className="border-border text-muted-foreground mb-6 max-w-3xl rounded-md border border-dashed p-3 text-sm">
        <span className="text-foreground font-medium">
          {t('retention.storage', { name: data.storage.name })}
        </span>
        {data.storage.objectLock ? (
          <>
            {' '}
            {t('retention.objectLockBefore', { mode: data.storage.mode ?? '' })}{' '}
            <span className="tabular">{data.storage.locked}</span> {t('retention.objectLockMiddle')}{' '}
            <span className="tabular">{data.storage.dated}</span> {t('retention.objectLockAfter')}
          </>
        ) : (
          <> — {data.storage.note}</>
        )}
        {data.storage.refused > 0 && (
          <span className="text-destructive block">{data.storage.note}</span>
        )}
      </p>

      <section className="border-border mb-8 max-w-3xl rounded-md border p-4">
        <h2 className="mb-1 text-sm font-semibold">{t('retention.entityHold')}</h2>
        <p className="text-muted-foreground mb-3 text-sm">{t('retention.entityHoldIntro')}</p>

        {data.legalHold.held ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              <span className="font-medium">{t('retention.holdOn')}</span>
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
              {t('retention.lift')}
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
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t('retention.why')}
              </span>
              <input
                name="reason"
                required
                placeholder={t('retention.whyPlaceholder')}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={!hydrated || busy}
              className="border-border rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              {t('retention.set')}
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
          {t('retention.empty')}
        </p>
      ) : (
        <>
          <table className="mb-4 w-full text-sm">
            <caption className="sr-only">{t('retention.caption')}</caption>
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th scope="col" className="w-8" />
                <th scope="col">{t('retention.document')}</th>
                <th scope="col">{t('retention.bookYear')}</th>
                <th scope="col">{t('retention.retainUntil')}</th>
                <th scope="col">{t('invoices.status')}</th>
                <th scope="col" className="text-right">
                  {t('retention.size')}
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((row) => (
                <tr key={row.id} className="border-border/50 border-t align-top">
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      aria-label={t('retention.select', {
                        name: row.filename ?? row.sha256.slice(0, 12),
                      })}
                      checked={chosen.has(row.id)}
                      disabled={!hydrated || row.state === 'deleted'}
                      onChange={() => {
                        toggle(row.id)
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    {row.filename ?? (
                      <span className="text-muted-foreground">{t('retention.unnamed')}</span>
                    )}
                    <span className="text-muted-foreground block text-xs">
                      {row.contentType} ·{' '}
                      {row.linkCount === 0
                        ? t('retention.notLinked')
                        : t('retention.linkedCount', { count: String(row.linkCount) })}
                    </span>
                  </td>
                  <td className="tabular py-1.5 pr-2 text-xs">{row.retentionFiscalYear ?? '—'}</td>
                  <td className="tabular py-1.5 pr-2 text-xs">
                    {row.retainUntil === null ? '—' : formatDate(row.retainUntil)}
                    <span className="text-muted-foreground block">{row.retentionClassLabel}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-xs">
                    <span className={row.state === 'expired' ? 'text-unreconciled' : undefined}>
                      {stateOf(row.state)}
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
                ? t('retention.selectPrompt')
                : t('retention.selected', {
                    count: String(chosen.size),
                    deletable: String(chosenDeletable.length),
                  })}
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
              {t('retention.tenYears')}
            </button>

            <label className="grow">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t('retention.reasonLabel')}
              </span>
              <input
                value={reason}
                onChange={(event) => {
                  setReason(event.currentTarget.value)
                }}
                placeholder={t('retention.reasonPlaceholder')}
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
              {t('retention.putOnHold')}
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
              {busy
                ? t('common.busy')
                : t('retention.deleteCount', { count: String(chosenDeletable.length) })}
            </button>
          </div>
        </>
      )}
    </>
  )
}
