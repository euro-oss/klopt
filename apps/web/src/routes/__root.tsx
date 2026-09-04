/// <reference types="vite/client" />
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
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
 */
export const Route = createRootRoute({
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
