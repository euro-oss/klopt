import { en } from './en.js'
import { nl, type MessageKey } from './nl.js'

/**
 * Which language, and how it is decided.
 *
 * ## Dutch is the default, and not merely the first entry
 *
 * A Dutch bookkeeping system whose fallback is English is one that greets a
 * Dutch bookkeeper in the wrong language whenever their browser is set oddly.
 * So the order is: what this person chose, then what their browser asks for if
 * we speak it, then Dutch.
 *
 * ## Resolved on the server, always
 *
 * `navigator.language` is not readable while the server renders, so a
 * component reading it during render produces different markup on each side
 * and React throws the tree away. That has already happened twice in this
 * codebase for other reasons.
 *
 * It is also unnecessary: `Accept-Language` is the same information, and the
 * browser sends it with the request. The locale is resolved once, in the root
 * loader, and travels down as data.
 */

export const LOCALES = ['nl', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'nl'

/** Where the chosen language is remembered. */
export const LOCALE_COOKIE = 'klopt_locale'

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'nl' || value === 'en'
}

/**
 * The best of what the browser asked for.
 *
 * `Accept-Language: en-GB,en;q=0.9,nl;q=0.8` is a ranked list, and the ranking
 * is the point — a browser set to British English with Dutch second should get
 * English. Region is dropped: `en-GB` and `en-US` are the same catalogue here,
 * and pretending otherwise would mean a language nobody had translated.
 */
export function preferredLocale(acceptLanguage: string | null): Locale | null {
  if (acceptLanguage === null || acceptLanguage.trim() === '') return null

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...parameters] = part.trim().split(';')
      const quality = parameters
        .map((parameter) => /^\s*q=([0-9.]+)\s*$/.exec(parameter))
        .find((match) => match !== null)
      return {
        language: tag.trim().toLowerCase().split('-')[0] ?? '',
        // No `q` means 1: the header's own default, and the reason an
        // unweighted first entry outranks a weighted later one.
        quality: quality?.[1] === undefined ? 1 : Number.parseFloat(quality[1]),
      }
    })
    .filter((entry) => entry.language !== '' && Number.isFinite(entry.quality))
    .sort((left, right) => right.quality - left.quality)

  for (const entry of ranked) {
    if (isLocale(entry.language)) return entry.language
  }
  return null
}

/** The whole decision, in one place. */
export function resolveLocale(options: {
  readonly cookie: string | null
  readonly acceptLanguage: string | null
}): Locale {
  if (isLocale(options.cookie)) return options.cookie
  return preferredLocale(options.acceptLanguage) ?? DEFAULT_LOCALE
}

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { nl, en }

export type Values = Readonly<Record<string, string | number>>

/**
 * One message, with its placeholders filled in.
 *
 * A missing value leaves `{name}` visible. Blanking it would produce a
 * grammatical sentence with a hole in it, which is the kind of thing that
 * survives review; `{name}` on screen does not.
 */
export function translate(locale: Locale, key: MessageKey, values?: Values): string {
  const template = CATALOGUES[locale][key]
  if (values === undefined) return template

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name]
    return value === undefined ? whole : String(value)
  })
}

/**
 * The countable form.
 *
 * Dutch and English both have exactly two, and `count` is passed through so
 * `{count}` works without the caller repeating it.
 */
export function translatePlural(
  locale: Locale,
  key: string,
  count: number,
  values?: Values,
): string {
  const suffix = count === 1 ? '_one' : '_other'
  return translate(locale, `${key}${suffix}` as MessageKey, { count, ...values })
}

/**
 * The tag `Intl` wants.
 *
 * Dutch formatting for Dutch, and **British** English rather than American:
 * this is a Dutch product, and `9/11/2026` for the eleventh of September is
 * the one date format that is wrong in a way nobody notices.
 */
export function intlTag(locale: Locale): string {
  return locale === 'nl' ? 'nl-NL' : 'en-GB'
}
