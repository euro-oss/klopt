/// <reference types="vite/client" />
import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '~/styles/app.css?url'
import { DEFAULT_LOCALE, intlTag, type Locale } from '~/i18n/locale'
import { LocaleProvider, useT } from '~/i18n/provider'
import { DEFAULT_THEME, themeClass, type Theme } from '~/lib/theme'
import { getLocale } from '~/server/locale'
import { getTheme } from '~/server/theme'

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
  /**
   * The language, decided once and handed down.
   *
   * In the root loader because every screen needs it and because it has to be
   * settled before anything renders: resolving it lower down would mean the
   * shell rendering in one language and its children in another for a frame.
   */
  /**
   * The theme rides along for the same reason: it is a class on `<html>`, so
   * it has to be decided before the document is written or the first paint is
   * the wrong theme — a white flash in a dark room.
   */
  loader: async () => ({ locale: await getLocale(), theme: await getTheme() }),
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
  // Deliberately not `useT()`: this renders when a loader failed, which may be
  // the loader that resolved the language. The default is better than a crash
  // inside an error screen.
  const { t } = useT()

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="mb-2 text-lg font-semibold">{t('error.title')}</h1>
      <p className="text-muted-foreground mb-4 text-sm">{t('error.body')}</p>
      <pre className="bg-muted mb-4 overflow-x-auto rounded-md p-3 text-xs">{error.message}</pre>
      <button
        type="button"
        onClick={() => {
          void router.invalidate()
        }}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
      >
        {t('common.retry')}
      </button>
    </div>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  /**
   * Read off the router state rather than with `useLoaderData`.
   *
   * This is the shell, so it also renders when a loader failed — and then
   * there is no loader data. `useLoaderData` throws in that case, which would
   * replace a useful error message with a blank document. Selecting from the
   * root match gives `undefined` instead, and `undefined` has a sensible
   * answer: the default language.
   */
  const { locale, theme } = useRouterState({
    select: (state) => {
      const data = state.matches[0]?.loaderData as { locale?: Locale; theme?: Theme } | undefined
      return { locale: data?.locale ?? DEFAULT_LOCALE, theme: data?.theme ?? DEFAULT_THEME }
    },
  })

  return (
    // The real language, for screen readers and for the browser's own
    // translation prompt. The fiscal terminology stays Dutch inside an English
    // UI (spec 12), but the document is in the language the user reads.
    <html lang={intlTag(locale)} className={themeClass(theme)}>
      <head>
        <HeadContent />
      </head>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <Scripts />
      </body>
    </html>
  )
}
