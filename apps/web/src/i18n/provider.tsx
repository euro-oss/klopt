import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  DEFAULT_LOCALE,
  intlTag,
  translate,
  translatePlural,
  type Locale,
  type Values,
} from './locale.js'
import type { MessageKey } from './nl.js'

/**
 * The current language, handed down rather than looked up.
 *
 * The locale is resolved once on the server and travels through the root
 * loader into this provider. Nothing under here reads `navigator.language`,
 * because a component that does renders one thing on the server and another in
 * the browser, and React responds by throwing the tree away.
 */

interface Translator {
  readonly locale: Locale
  readonly t: (key: MessageKey, values?: Values) => string
  readonly plural: (key: string, count: number, values?: Values) => string
  /** For `Intl`: `nl-NL` or `en-GB`. */
  readonly tag: string
}

const LocaleContext = createContext<Translator | null>(null)

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<Translator>(
    () => ({
      locale,
      t: (key, values) => translate(locale, key, values),
      plural: (key, count, values) => translatePlural(locale, key, count, values),
      tag: intlTag(locale),
    }),
    [locale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * The translator for the current screen.
 *
 * Falls back to Dutch rather than throwing when there is no provider above it.
 * A missing provider should show a screen in the default language, not a blank
 * one — this is the kind of thing that would otherwise be discovered by a
 * component rendered in a context nobody thought about.
 */
export function useT(): Translator {
  return useContext(LocaleContext) ?? FALLBACK
}

/**
 * Hoisted rather than built per call, so that `t` is referentially stable even
 * without a provider. Screens put `t` in a `useCallback` dependency array; a
 * fresh object every render would quietly turn those into no-ops.
 */
const FALLBACK: Translator = {
  locale: DEFAULT_LOCALE,
  t: (key, values) => translate(DEFAULT_LOCALE, key, values),
  plural: (key, count, values) => translatePlural(DEFAULT_LOCALE, key, count, values),
  tag: intlTag(DEFAULT_LOCALE),
}
