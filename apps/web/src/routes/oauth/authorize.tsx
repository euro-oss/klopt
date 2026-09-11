import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { approveAuthorizationRequest, describeAuthorization } from '~/server/oauth'

/**
 * The consent screen — the only place a human decides (spec 10.3).
 *
 * Everything else in the OAuth flow is machinery. This is the moment somebody
 * is told what is about to be given away and to whom, so it says the things
 * that matter and not much else: which client, which administration, and what
 * it will be able to read.
 *
 * ## The client's name is not to be trusted
 *
 * Registration is open, so `client_name` is whatever the client called itself.
 * It is shown because it is useful and withheld from any emphasis, next to the
 * redirect host — which is the part an attacker cannot fake, because the code
 * goes there and nowhere else.
 */
export const Route = createFileRoute('/oauth/authorize')({
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ location }) => {
    const query = location.searchStr.replace(/^\?/, '')
    const description = await describeAuthorization({ data: { query } })

    // A refusal that can be reported to the client is reported to the client:
    // that is how the client learns to fix it, rather than the person staring
    // at a page they cannot act on.
    if (description.refusal !== null && description.redirectTo !== null) {
      throw redirect({ href: description.redirectTo })
    }

    // A refusal that cannot be reported is rendered here — and *before* the
    // sign-in check, because there is no reason to make somebody produce
    // credentials only to be told the request was never going to work. The
    // unregistered-redirect case is exactly this: the one thing that must not
    // happen is bouncing to that URI, and sign-in has nothing to do with it.
    if (description.refusal === null && !description.signedIn) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }

    return { query, description }
  },
  component: Authorize,
})

function Authorize() {
  const { query, description } = Route.useLoaderData()
  const router = useRouter()
  const hydrated = useHydrated()
  const { t } = useT()

  /** An unrecognised scope is shown raw rather than as a blank. */
  const scopeOf = (scope: string) => {
    const key = SCOPE_KEY[scope]
    return key === undefined ? scope : t(key)
  }

  const [entityId, setEntityId] = useState(description.memberships[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (description.refusal !== null) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">{t('consent.badRequest')}</h1>
        <p role="alert" className="text-destructive mt-3 text-sm">
          {description.refusal.description}
        </p>
        <p className="text-muted-foreground mt-4 text-sm">{t('consent.badRequestBody')}</p>
      </main>
    )
  }

  const redirectHost = (() => {
    try {
      return new URL(new URLSearchParams(query).get('redirect_uri') ?? '').host
    } catch {
      return ''
    }
  })()

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      const { redirectTo } = await approveAuthorizationRequest({ data: { query, entityId } })
      // Leaving the app is the last step of the flow, not a navigation within
      // it: the code belongs to the client, at the address it registered.
      window.location.assign(redirectTo)
    } catch (cause: unknown) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : t('common.unknownError'))
    }
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">{t('consent.title')}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {t('consent.signedInAs', { user: description.user ?? '' })}
      </p>

      <div className="border-border mt-6 rounded-md border p-4">
        <p className="text-sm">
          <strong>{description.clientName}</strong> {t('consent.asksFor')}
        </p>
        {redirectHost !== '' && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t('consent.grantedToBefore')} <code>{redirectHost}</code>
            {t('consent.grantedToAfter')}
          </p>
        )}

        <SelectField
          label={t('consent.administration')}
          value={entityId}
          onValueChange={setEntityId}
          disabled={!hydrated || description.memberships.length === 1}
          hint={t('consent.onlyThisOne')}
          className="mt-4"
        >
          {description.memberships.map((membership) => (
            <SelectOption key={membership.id} value={membership.id}>
              {membership.name}
            </SelectOption>
          ))}
        </SelectField>

        <p className="mt-4 text-sm font-medium">{t('consent.whatItMay')}</p>
        <ul className="text-muted-foreground mt-1 list-disc pl-5 text-sm">
          {description.scope.map((scope) => (
            <li key={scope}>{scopeOf(scope)}</li>
          ))}
          <li>{t('consent.nothingElse')}</li>
        </ul>

        <p className="text-muted-foreground mt-4 text-xs">{t('consent.expires')}</p>
      </div>

      {error !== null && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          disabled={busy || !hydrated || entityId === ''}
          onClick={() => void approve()}
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? t('common.busy') : t('consent.title')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void router.navigate({ to: '/' })}
          className="border-border rounded-md border px-3 py-1.5 text-sm"
        >
          {t('common.cancel')}
        </button>
      </div>
    </main>
  )
}

const SCOPE_KEY: Readonly<Record<string, MessageKey>> = {
  'ledger:read': 'consent.scope.read',
  'ledger:export': 'consent.scope.export',
}
