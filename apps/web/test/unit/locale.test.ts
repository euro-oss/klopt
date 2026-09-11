import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  intlTag,
  preferredLocale,
  resolveLocale,
  translate,
  translatePlural,
} from '../../src/i18n/locale.js'
import { nl } from '../../src/i18n/nl.js'
import { en } from '../../src/i18n/en.js'

/**
 * Which language somebody gets, and why.
 *
 * The rule the user asked for: their own choice, then the browser's if we
 * speak it, then Dutch. The interesting cases are all in the middle term.
 */

describe('what the browser asked for', () => {
  it('takes a plain tag', () => {
    expect(preferredLocale('en')).toBe('en')
    expect(preferredLocale('nl')).toBe('nl')
  })

  it('ignores the region, because there is one catalogue per language', () => {
    // `en-GB` and `en-US` are the same words here. Treating them as different
    // languages would mean asking for one nobody has translated.
    expect(preferredLocale('en-GB')).toBe('en')
    expect(preferredLocale('nl-BE')).toBe('nl')
  })

  it('respects the ranking rather than the order', () => {
    // A browser set to German first, Dutch second, English third should get
    // Dutch — not English because it appears in the string.
    expect(preferredLocale('de-DE,de;q=0.9,nl;q=0.8,en;q=0.7')).toBe('nl')
    expect(preferredLocale('de;q=0.9,en;q=0.8,nl;q=0.7')).toBe('en')
  })

  it('treats a missing q as 1, which is what the header means', () => {
    // `en` unweighted outranks `nl;q=0.9`, even though nl comes with a number
    // and en does not.
    expect(preferredLocale('en,nl;q=0.9')).toBe('en')
  })

  it('answers null when it speaks none of them', () => {
    expect(preferredLocale('de-DE,de;q=0.9,fr;q=0.8')).toBeNull()
    expect(preferredLocale('')).toBeNull()
    expect(preferredLocale(null)).toBeNull()
  })
})

describe('the whole decision', () => {
  it('honours a choice over the browser', () => {
    // Somebody who picked Dutch on an English browser meant it.
    expect(resolveLocale({ cookie: 'nl', acceptLanguage: 'en-GB,en;q=0.9' })).toBe('nl')
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'nl' })).toBe('en')
  })

  it('follows the browser when there is no choice yet', () => {
    expect(resolveLocale({ cookie: null, acceptLanguage: 'en-US,en;q=0.9' })).toBe('en')
  })

  it('falls back to Dutch, not to English', () => {
    /**
     * The default matters more than it looks. This is a Dutch bookkeeping
     * package; an unrecognised browser language greeting a Dutch bookkeeper in
     * English is the wrong way round.
     */
    expect(resolveLocale({ cookie: null, acceptLanguage: 'de-DE' })).toBe('nl')
    expect(resolveLocale({ cookie: null, acceptLanguage: null })).toBe('nl')
    expect(DEFAULT_LOCALE).toBe('nl')
  })

  it('ignores a cookie that is not a language we have', () => {
    // Somebody editing their cookies, or a locale we dropped.
    expect(resolveLocale({ cookie: 'fr', acceptLanguage: 'en' })).toBe('en')
    expect(resolveLocale({ cookie: '', acceptLanguage: null })).toBe('nl')
  })
})

describe('the catalogues', () => {
  it('say the same things in both languages', () => {
    // `en` is typed as a complete record of `nl`'s keys, so this cannot drift —
    // but the assertion states the property rather than leaving it to a type
    // somebody could widen.
    expect(Object.keys(en).sort()).toEqual(Object.keys(nl).sort())
  })

  it('leaves no message empty', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key}`).not.toBe('')
    }
  })

  it('uses the same placeholders on both sides', () => {
    /**
     * A translation that drops `{email}` renders a sentence with the fact
     * missing and reads perfectly well, which is how it survives review.
     */
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

    for (const key of Object.keys(nl) as (keyof typeof nl)[]) {
      expect(placeholders(en[key]), `placeholders in ${key}`).toEqual(placeholders(nl[key]))
    }
  })
})

describe('rendering a message', () => {
  it('fills placeholders in', () => {
    expect(translate('nl', 'signIn.codeSent', { email: 'a@b.nl' })).toContain('a@b.nl')
    expect(translate('en', 'signIn.codeSent', { email: 'a@b.nl' })).toContain('a@b.nl')
  })

  it('leaves a missing value visible rather than blanking it', () => {
    // An obvious `{email}` gets reported. A sentence with a gap does not.
    expect(translate('nl', 'signIn.codeSent', {})).toContain('{email}')
  })

  it('picks the countable form', () => {
    expect(translatePlural('en', 'common.count', 1)).toBe('1 line')
    expect(translatePlural('en', 'common.count', 3)).toBe('3 lines')
    expect(translatePlural('nl', 'common.count', 1)).toBe('1 regel')
    expect(translatePlural('nl', 'common.count', 0)).toBe('0 regels')
  })
})

describe('formatting', () => {
  it('asks for British English rather than American', () => {
    // 9/11/2026 for the eleventh of September is wrong in the one way nobody
    // notices.
    expect(intlTag('en')).toBe('en-GB')
    expect(intlTag('nl')).toBe('nl-NL')
  })
})
