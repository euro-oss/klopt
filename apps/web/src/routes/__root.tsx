/// <reference types="vite/client" />
import { HeadContent, Outlet, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppShell } from '~/components/app-shell'
import { getSession } from '~/server/context'
import { switchEntity } from '~/server/ledger'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Klopt' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  // Loaded once for the shell. Screens get their own data.
  loader: async () => ({ session: await getSession() }),
  shellComponent: RootDocument,
  component: RootLayout,
})

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

function RootLayout() {
  const { session } = Route.useLoaderData()
  const router = useRouter()

  if (session === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
        <h1 className="text-2xl font-semibold">Klopt</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Meld je aan om deze administratie te openen.
        </p>
        <a
          href="/sign-in"
          className="bg-primary text-primary-foreground mt-6 rounded-md px-4 py-2 text-center text-sm font-medium"
        >
          Aanmelden
        </a>
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
