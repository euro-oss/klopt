import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
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

  const [entityId, setEntityId] = useState(description.memberships[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (description.refusal !== null) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">Deze aanvraag klopt niet</h1>
        <p role="alert" className="text-destructive mt-3 text-sm">
          {description.refusal.description}
        </p>
        <p className="text-muted-foreground mt-4 text-sm">
          Er is niets toegekend. Sluit dit venster en probeer het opnieuw vanuit de app die de
          koppeling wilde maken.
        </p>
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
      setError(cause instanceof Error ? cause.message : 'Onbekende fout.')
    }
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-semibold">Toegang geven</h1>
      <p className="text-muted-foreground mt-1 text-sm">Je bent ingelogd als {description.user}.</p>

      <div className="border-border mt-6 rounded-md border p-4">
        <p className="text-sm">
          <strong>{description.clientName}</strong> vraagt toegang tot je boekhouding.
        </p>
        {redirectHost !== '' && (
          <p className="text-muted-foreground mt-2 text-xs">
            De toegang wordt afgegeven aan <code>{redirectHost}</code>. Herken je dat adres niet,
            geef dan geen toegang.
          </p>
        )}

        <label className="mt-4 block text-sm">
          Administratie
          <select
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            disabled={!hydrated || description.memberships.length === 1}
            className="border-border mt-1 w-full rounded-md border px-2 py-1.5"
          >
            {description.memberships.map((membership) => (
              <option key={membership.id} value={membership.id}>
                {membership.name}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground mt-1 block text-xs">
            De toegang geldt alleen voor deze administratie.
          </span>
        </label>

        <p className="mt-4 text-sm font-medium">Wat het mag:</p>
        <ul className="text-muted-foreground mt-1 list-disc pl-5 text-sm">
          {description.scope.map((scope) => (
            <li key={scope}>{SCOPE_TEXT[scope] ?? scope}</li>
          ))}
          <li>Niets wijzigen, niets boeken, niets versturen.</li>
        </ul>

        <p className="text-muted-foreground mt-4 text-xs">
          De toegang vervalt automatisch na een uur. Je kunt hem eerder intrekken bij Toegang.
        </p>
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
          {busy ? 'Bezig…' : 'Toegang geven'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void router.navigate({ to: '/' })}
          className="border-border rounded-md border px-3 py-1.5 text-sm"
        >
          Annuleren
        </button>
      </div>
    </main>
  )
}

const SCOPE_TEXT: Readonly<Record<string, string>> = {
  'ledger:read': 'De boeken lezen: saldi, facturen, openstaande posten, BTW-overzichten.',
  'ledger:export': 'Exports maken, zoals een auditfile.',
}
