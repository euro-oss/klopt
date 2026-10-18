import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { AppShell } from '~/components/app-shell'
import { useT } from '~/i18n/provider'
import { AdvancedModeProvider } from '~/lib/advanced-mode-context'
import { isYearScopedRoute } from '~/lib/fiscal-year'
import { getAdvancedMode } from '~/server/advanced-mode'
import { getSession } from '~/server/context'
import { getReportYear, setReportYear } from '~/server/fiscal-year'
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
  /**
   * The book year is resolved here, once, for every screen inside the shell.
   *
   * Not in each route: the picker is in the chrome, so the list it offers and
   * the year it shows have to outlive a navigation, and a layout loader is
   * exactly the thing that does. `router.invalidate()` after a change re-runs
   * this and every child loader, which is what makes changing the year move
   * the queue and the reports together.
   */
  loader: async ({ context }) => {
    const session = context.session
    // A member of nothing has no books to pick a year from, and asking would
    // be a 403 on the way to a screen that says "set one up".
    const reportYear = session.memberships.length === 0 ? null : await getReportYear()
    const active =
      session.memberships.find((m) => m.entityId === session.activeEntityId) ??
      session.memberships[0]
    const advancedPreference =
      session.memberships.length === 0
        ? { enabled: false, hasExplicit: false }
        : await getAdvancedMode({
            data: { role: active?.role ?? '', userId: session.user.id },
          })
    return {
      session,
      reportYear,
      advanced: advancedPreference.enabled,
      advancedHasExplicit: advancedPreference.hasExplicit,
      activeRole: active?.role ?? '',
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { session, reportYear, advanced, advancedHasExplicit, activeRole } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { t } = useT()

  if (session.memberships.length === 0) {
    // Signed in and a member of nothing. This used to be a dead end, which
    // made principle 4 false in the most literal way available: a fresh
    // install had no route to a first set of books that did not involve SQL.
    // When signup is closed, only instance admins may create — everyone else
    // needs an invitation, so the create link stays off the screen.
    const canCreate = session.mayCreateEntity !== false
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
        <h1 className="text-2xl font-semibold">{t('setup.needOne')}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {t(canCreate ? 'setup.needOneBody' : 'setup.needOneClosedBody', {
            email: session.user.email,
          })}
        </p>
        {canCreate && (
          <Link
            to="/setup"
            className="bg-primary text-primary-foreground mt-6 rounded-none px-4 py-2 text-center text-sm font-medium"
          >
            {t('setup.start')}
          </Link>
        )}
        <form method="post" action="/sign-out" className={canCreate ? 'mt-3' : 'mt-6'}>
          <button
            type="submit"
            className="border-input w-full rounded-none border px-4 py-2 text-sm"
          >
            {t('shell.signOut')}
          </button>
        </form>
      </main>
    )
  }

  return (
    <AdvancedModeProvider
      userId={session.user.id}
      role={activeRole}
      initial={advanced}
      initialHasExplicit={advancedHasExplicit}
    >
      <AppShell
        entities={session.memberships}
        activeEntityId={session.activeEntityId}
        userName={session.user.name}
        userEmail={session.user.email}
        fiscalYears={reportYear?.ok === true ? reportYear.data.years : []}
        activeYear={reportYear?.ok === true ? reportYear.data.scope : null}
        onSelectYear={(code) => {
          // Same shape as switching administration: an unhandled rejection here
          // takes down the layout every screen renders inside, and the year a
          // reader is looking at is not worth a blank page.
          void setReportYear({ data: { code } })
            .then(async () => {
              // Into the address as well as into the cookie, where the screen
              // reads it: a report is a thing people send each other, and a link
              // that shows the sender's year and the reader's figures is worse
              // than no link. Everywhere else the cookie carries the choice, and
              // `invalidate` is what makes the screens re-read it.
              if (isYearScopedRoute(pathname)) {
                await navigate({ to: pathname, search: { fiscalYear: Number(code) } })
              }
              await router.invalidate()
            })
            .catch((cause: unknown) => {
              console.error('[app] could not change book year', cause)
            })
        }}
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
    </AdvancedModeProvider>
  )
}
