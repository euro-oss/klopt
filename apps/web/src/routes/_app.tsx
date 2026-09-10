import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { AppShell } from '~/components/app-shell'
import { getSession } from '~/server/context'
import { switchEntity } from '~/server/ledger'

/**
 * Everything you have to be signed in to see.
 *
 * A pathless layout, so the guard lives in one place rather than in each
 * screen. `beforeLoad` runs before any child loader, so an unauthenticated
 * visitor is redirected before a single query is issued — and `/sign-in`, which
 * is not under this layout, renders normally.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (session === null) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { session }
  },
  loader: ({ context }) => ({ session: context.session }),
  component: AppLayout,
})

function AppLayout() {
  const { session } = Route.useLoaderData()
  const router = useRouter()

  if (session.memberships.length === 0) {
    // Signed in and a member of nothing. This used to be a dead end, which
    // made principle 4 false in the most literal way available: a fresh
    // install had no route to a first set of books that did not involve SQL.
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
        <h1 className="text-2xl font-semibold">Nog geen administratie</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Je bent aangemeld als {session.user.email}. Zet een administratie op, of vraag een
          eigenaar om je uit te nodigen voor een bestaande.
        </p>
        <Link
          to="/setup"
          className="bg-primary text-primary-foreground mt-6 rounded-md px-4 py-2 text-center text-sm font-medium"
        >
          Administratie opzetten
        </Link>
        <form method="post" action="/sign-out" className="mt-3">
          <button type="submit" className="border-input w-full rounded-md border px-4 py-2 text-sm">
            Afmelden
          </button>
        </form>
      </main>
    )
  }

  return (
    <AppShell
      entities={session.memberships}
      activeEntityId={session.memberships[0]?.entityId ?? null}
      userName={session.user.name}
      onSwitchEntity={(entityId) => {
        // Same shape as the bug in bank.match: an unhandled rejection here
        // takes down the layout every screen renders inside. Switching
        // administrations is exactly when somebody is about to look at
        // numbers, and blanking the page is the worst available answer —
        // staying put on the administration they were already in is not.
        void switchEntity({ data: { entityId } })
          .then(() => router.invalidate())
          .catch((cause: unknown) => {
            console.error('[app] could not switch administration', cause)
          })
      }}
    >
      <Outlet />
    </AppShell>
  )
}
