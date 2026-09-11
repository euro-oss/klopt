# 0038. Dutch is the source, English is a translation

Status: Accepted
Date: 2026-09-11

## Context

Spec 12 asks for a Dutch-first interface with English available. Klopt is a
Dutch bookkeeping package: it speaks about `grootboekrekeningen`, `dagboeken`,
`btw-aangifte`, `RGS` and `KvK`, and those words are the actual vocabulary of
the job, not a localisation of an English original. Most of the terms have no
English equivalent that a Dutch bookkeeper would recognise, and several — RGS
codes, the rubrieken on an aangifte — are defined by Dutch law.

At the same time, the people running a Dutch BV are not all Dutch speakers.
An English UI is what makes the package usable by a founder who moved here
last year and still has to file a return.

## Dutch is the source of truth

`nl.ts` is a plain object and its keys _are_ the type:

```ts
export const nl = { 'nav.entries': 'Journaalposten', … } as const
export type MessageKey = keyof typeof nl
```

`en.ts` is then declared as `Record<MessageKey, string>`. A key added to Dutch
and not to English is a **compile error**, not a string that silently falls
back at runtime in front of a user. This is the whole reason for hand-rolling
two objects instead of reaching for an i18n library: the libraries almost all
treat catalogues as data loaded at runtime, and a missing key becomes either
the key itself rendered on screen or a silent fallback. Neither is something
you find before shipping. A type error is.

The direction matters too. Writing English first and translating to Dutch is
how you end up with "Journal entries" translated to something no bookkeeper
says. Writing Dutch first means the English is a translation of the right
thing.

## The language is decided on the server, once

The order is: **the cookie, then `Accept-Language`, then Dutch.**

- The cookie is an explicit choice, so it outranks everything.
- `Accept-Language` is what the browser already sends on the request. Nothing
  is detected in the page.
- Dutch is the fallback, including for a browser asking for a language we do
  not have. A Dutch bookkeeping package that falls back to English for a German
  browser has it exactly the wrong way round.

Deciding it on the server is not only tidier, it is the only version that is
correct. Reading `navigator.language` during render would produce different
markup on the server and the client, which is the hydration mismatch this
codebase has already been bitten by twice (see `useHydrated`). Because the
locale arrives as part of the request, the server render and the first client
render agree by construction.

The root loader resolves it and `RootDocument` reads it out of the router state
rather than `useLoaderData` — a failed loader must still render the error
screen, in some language, rather than blanking it.

## The switcher is labelled in both languages

`Taal / Language`, in the sidebar, not inside Instellingen. Somebody who has
landed in the wrong language cannot read the word for "language" in order to go
looking for it, and cannot navigate three screens deep in a language they do
not speak to fix it. It is two words of redundancy that make the control
self-rescuing.

## Consequences

- Month names come from `Intl`, not from a list. The twelve names are facts
  `Intl` already holds, and a second copy is a second thing to translate and
  get out of step.
- The e2e suite pins `locale: 'nl-NL'`. Chromium defaults to `en-US`, which the
  app now correctly honours — which would otherwise make every spec asserting
  Dutch copy depend on where it runs. The specs about language negotiation open
  their own contexts.
- Two tests guard the pair of catalogues: identical key sets, and **identical
  placeholders within each message**. A translation that drops `{email}` loses
  information rather than looking wrong, so it has to be caught mechanically.
- Errors raised in `@klopt/core` are still English and still surface in the UI.
  They are not message keys and cannot be, because the domain layer has no
  locale. Translating them means giving problems a code and mapping the code in
  the UI; until that happens a Dutch user can still meet an English sentence
  from the domain.
