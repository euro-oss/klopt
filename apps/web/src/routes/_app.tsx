import { Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
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
    // Signed in, but invited to nothing. A dead end rather than an error page:
    // the account is fine, it just cannot see any books yet.
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
        <h1 className="text-2xl font-semibold">Nog geen administratie</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Je bent aangemeld als {session.user.email}, maar je hebt nog geen toegang tot een
          administratie. Vraag een eigenaar om je uit te nodigen.
        </p>
        <form method="post" action="/sign-out" className="mt-6">
          <button type="submit" className="border-input rounded-md border px-4 py-2 text-sm">
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
        void switchEntity({ data: { entityId } }).then(() => router.invalidate())
      }}
    >
      <Outlet />
    </AppShell>
  )
}
