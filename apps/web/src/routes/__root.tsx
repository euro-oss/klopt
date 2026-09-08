/// <reference types="vite/client" />
import { HeadContent, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '~/styles/app.css?url'

/**
 * The document, and nothing else.
 *
 * No authentication here. An earlier version put the signed-out placeholder in
 * this component and returned it *instead of* `<Outlet />`, which meant every
 * route rendered the placeholder while signed out — including `/sign-in`. The
 * URL changed and the page did not, so the sign-in link appeared to do nothing.
 *
 * Guarding belongs in `_app`, the layout the authenticated routes live under.
 * `/sign-in` sits outside it and renders itself.
 *
 * There *is* an `errorComponent`, and it earns its place. Every screen loads
 * through a server function, and a loader that fails — a dropped connection, a
 * request aborted by navigating away, a server that restarted — used to render
 * nothing at all: React's own warning said "the following error wasn't caught
 * by any route", and the user saw a blank frame with no way to know whether the
 * data was slow or gone. A blank screen is the one failure mode nobody can
 * report usefully.
 */
export const Route = createRootRoute({
  errorComponent: RootError,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Klopt' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

/**
 * What a failed load looks like.
 *
 * Deliberately plain, and deliberately offering a retry: the commonest cause is
 * transient — a connection that dropped or a navigation that cancelled a
 * request in flight — and `invalidate()` re-runs the loaders without a full
 * reload. The message is shown rather than swallowed, because a bookkeeper who
 * can say what it said is a bookkeeper who can be helped.
 */
function RootError({ error }: { error: Error }) {
  const router = useRouter()

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="mb-2 text-lg font-semibold">Dit scherm kon niet geladen worden</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        Meestal is de verbinding even weg. Probeer het opnieuw; als het blijft gebeuren, is dit de
        melding om door te geven.
      </p>
      <pre className="bg-muted mb-4 overflow-x-auto rounded-md p-3 text-xs">{error.message}</pre>
      <button
        type="button"
        onClick={() => {
          void router.invalidate()
        }}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
      >
        Opnieuw proberen
      </button>
    </div>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // Dutch: the fiscal terminology stays Dutch even in the English UI
    // (spec 12), so the document language should not claim otherwise.
    <html lang="nl-NL">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
