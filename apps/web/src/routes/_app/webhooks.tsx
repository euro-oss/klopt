import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { PageHeader } from '~/components/app-shell'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import { useHydrated } from '~/lib/hydration'
import { createWebhook, deleteWebhook, listWebhooks, replayWebhook } from '~/server/webhooks'

/**
 * Webhook subscriptions (spec 10.2).
 *
 * The screen exists because the failure mode this design has is *silence*.
 * Delivery is ordered, so a subscriber that stops answering does not lose one
 * event — it stops receiving all of them, and the integrator's system looks
 * fine from the inside while drifting a week behind. So the two things this
 * page must make unmissable are how far behind an endpoint is and, if it was
 * switched off, why.
 */
export const Route = createFileRoute('/_app/webhooks')({
  loader: async () => ({ webhooks: await listWebhooks() }),
  component: Webhooks,
})

function Webhooks() {
  const { webhooks } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [issued, setIssued] = useState<{ url: string; secret: string } | null>(null)
  const key = useRef(crypto.randomUUID())

  if (!webhooks.ok) {
    return (
      <>
        <PageHeader title={t('webhooks.title')} />
        <p role="alert" className="text-destructive text-sm">
          {webhooks.problem.detail}
        </p>
      </>
    )
  }

  const { endpoints, available } = webhooks.data

  async function run(work: () => Promise<{ ok: boolean; problem?: { detail: string } }>) {
    setBusy(true)
    setError(null)
    const result = await work()
    setBusy(false)

    if (!result.ok) {
      setError(result.problem?.detail ?? t('common.unknownError'))
      return null
    }

    key.current = crypto.randomUUID()
    await router.invalidate()
    return result
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    // `FormData.get` is `string | File | null`; only the string branch is ours.
    const raw = form.get('url')
    const url = typeof raw === 'string' ? raw.trim() : ''
    const eventTypes = form.getAll('eventTypes').map(String)

    setBusy(true)
    setError(null)
    const result = await createWebhook({
      data: { url, eventTypes, idempotencyKey: key.current },
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.problem.detail)
      return
    }

    key.current = crypto.randomUUID()
    setIssued({ url: result.data.url, secret: result.data.secret })
    setOpen(false)
    await router.invalidate()
  }

  return (
    <>
      <PageHeader
        title={t('webhooks.title')}
        description={t('webhooks.intro')}
        actions={
          <button
            type="button"
            disabled={!hydrated}
            onClick={() => {
              setOpen((value) => !value)
            }}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {open ? t('common.cancel') : t('webhooks.add')}
          </button>
        }
      />

      <p className="text-muted-foreground mb-6 max-w-3xl text-sm">
        {t('webhooks.pollInstead', { link: t('webhooks.pollLink') })}
      </p>

      {error !== null && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      )}

      {/*
        The secret exists in a readable form exactly once, here. Same bargain
        as an API token, and for the same reason: only the encrypted copy is
        kept, so there is no screen that could show it again later.
      */}
      {issued !== null && (
        <div className="border-border bg-muted/40 mb-6 max-w-2xl rounded-md border p-4">
          <p className="text-sm font-medium">{t('webhooks.secretTitle')}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t('webhooks.secretOnce')}</p>
          <code className="mt-2 block overflow-x-auto rounded bg-black/5 p-2 font-mono text-xs">
            {issued.secret}
          </code>
          <button
            type="button"
            onClick={() => {
              setIssued(null)
            }}
            className="border-border mt-3 rounded-md border px-2 py-1 text-xs"
          >
            {t('webhooks.secretSaved')}
          </button>
        </div>
      )}

      {open && (
        <form
          onSubmit={(event) => void add(event)}
          className="border-border mb-8 max-w-2xl space-y-4 rounded-md border p-4"
        >
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t('webhooks.url')}
            </span>
            <input
              name="url"
              type="url"
              required
              placeholder="https://example.nl/klopt/webhook"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <span className="text-muted-foreground mt-1 block text-xs">
              {t('webhooks.urlHint')}
            </span>
          </label>

          <fieldset>
            <legend className="text-muted-foreground mb-1 text-xs font-medium">
              {t('webhooks.types')}
            </legend>
            <div className="space-y-1">
              {available.map((entry) => (
                <label key={entry.type} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="eventTypes" value={entry.type} className="mt-1" />
                  <span>
                    <code className="text-xs">{entry.type}</code>
                    <span className="text-muted-foreground block text-xs">{entry.summary}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">{t('webhooks.allTypes')}</p>
          </fieldset>

          <button
            type="submit"
            disabled={busy || !hydrated}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? t('common.busy') : t('webhooks.create')}
          </button>
        </form>
      )}

      {endpoints.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-sm">
          {t('webhooks.none')}
        </p>
      ) : (
        <ul className="max-w-4xl space-y-4">
          {endpoints.map((endpoint) => (
            <li key={endpoint.id} className="border-border rounded-md border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <code className="text-sm break-all">{endpoint.url}</code>
                <span
                  className={
                    endpoint.enabled ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'
                  }
                >
                  {endpoint.enabled ? t('webhooks.enabled') : t('webhooks.disabled')}
                </span>
              </div>

              {endpoint.disabledReason !== null && (
                <p role="alert" className="text-destructive mt-2 text-sm">
                  {endpoint.disabledReason}
                </p>
              )}

              <p className="text-muted-foreground mt-2 text-xs">
                {endpoint.backlog > 0
                  ? t('webhooks.backlog', { count: String(endpoint.backlog) })
                  : t('webhooks.upToDate')}
                {' · '}
                {endpoint.lastSuccessAt === null
                  ? t('webhooks.never')
                  : t('webhooks.lastSuccess', {
                      date: formatDate(endpoint.lastSuccessAt.slice(0, 10)),
                    })}
                {endpoint.eventTypes.length > 0 && ` · ${endpoint.eventTypes.join(', ')}`}
              </p>

              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <button
                  type="button"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void run(() =>
                      replayWebhook({
                        data: {
                          endpointId: endpoint.id,
                          after: null,
                          idempotencyKey: key.current,
                        },
                      }),
                    )
                  }}
                  className="border-border rounded-md border px-2 py-1 disabled:opacity-50"
                >
                  {endpoint.enabled ? t('webhooks.replay') : t('webhooks.reenable')}
                </button>
                <button
                  type="button"
                  disabled={busy || !hydrated}
                  onClick={() => {
                    void run(() =>
                      deleteWebhook({
                        data: { endpointId: endpoint.id, idempotencyKey: key.current },
                      }),
                    )
                  }}
                  className="text-muted-foreground hover:text-destructive underline disabled:opacity-50"
                >
                  {t('webhooks.remove')}
                </button>
              </div>

              {endpoint.attempts.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs underline">
                    {t('webhooks.attempts')}
                  </summary>
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground text-left">
                        <th scope="col" className="py-1">
                          {t('webhooks.attemptWhen')}
                        </th>
                        <th scope="col" className="py-1">
                          {t('webhooks.attemptResult')}
                        </th>
                        <th scope="col" className="py-1 text-right">
                          {t('exact.durationColumn')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {endpoint.attempts.map((attempt, index) => (
                        <tr key={`${attempt.eventId}-${String(index)}`}>
                          <td className="tabular py-1">
                            {attempt.at.slice(0, 19).replace('T', ' ')}
                          </td>
                          <td className="py-1">
                            {attempt.responseStatus ?? t('webhooks.attemptNoReply')}
                            {attempt.error !== null && (
                              <span className="text-muted-foreground"> {attempt.error}</span>
                            )}
                          </td>
                          <td className="tabular py-1 text-right">
                            {String(attempt.durationMs)} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
