# 0057. A hundred and nine of a hundred and nine

Status: Accepted
Date: 2026-09-17
Amends: ADR 0044, ADR 0050

## Context

The response-conformance suite checked 45 of 117 operations. ADR 0050 made the
collection reads manifest-driven, so a new one fails the suite the day it
appears; the note beside it said the rest "needs setting up first: a path
parameter wants an id, a write wants a body", and called them "one test each
rather than a loop".

That was accurate and it stayed true for months, which is the problem with it.
"Forty-five of a hundred and seventeen" was a number nobody could act on — the
list of seventy-two was never written down, so the gap had no shape, and a gap
with no shape does not close.

Every JSON operation the API has is now checked: 109, with the other 8
answering XML, CSV, a PDF or raw bytes.

## The writes are a scenario, not a loop

A loop needs each case to be independent. Writes are not: an invoice has to be
drafted before it is issued, an approved cost before a payment batch will take
it, a filing before there is a status to poll. Generating bodies from schemas
would produce requests the domain correctly refuses.

So it is one ordered scenario, in named steps, each leaving its ids for the
next. A failure names the step and everything after it fails too — which is
right, and is what a shared fixture set would have hidden.

**Nothing in it asserts behaviour.** Every area already has a suite that does,
and a second copy of those assertions would be two places to update when a rule
changes. The only claim made here is that the published schema describes what
came back.

## Three things the API refused, correctly, and what they cost

The scenario had to be made real rather than made to pass, and three
refusals were load-bearing:

- **`approval_by_script`.** Approving a cost is deliberately something only a
  person may do, so the suite's token is `actorKind: 'human'` — a human working
  through the API, which is a real and supported thing to be.
- **`setup.createEntity` and the member operations read `context.user`.** An
  invitation is issued _by_ somebody, and a token is not a somebody. Those run
  through a real better-auth session. An invitation also only becomes a
  membership when that address signs in, so the scenario signs it in.
- **`retention.deleteDocuments` needs an expired document.** The term is
  _derived_ — the handler recomputes it from the book year of whatever the
  document is evidence for — so backdating the column does nothing, and a 2026
  invoice is kept until 2033. A first attempt added a `expireRetention` test
  seam to `@klopt/db`; it did not work, and the reason it did not work was the
  right answer: the operation is reached through a second administration whose
  books are from 2015. No seam, and the test now exercises the real derivation.

## The Exact eight

The excuse for these was "a connection that only OAuth can make". True — and
`exact.test.ts` has been making one all along, against a fake Exact that
replaces `globalThis.fetch`. The fake moved to `test/support/exact-online.ts`
and both suites use it. That was the whole of the work, and the reason it sat
undone for months is that the excuse sounded final.

The fake stays one copy on purpose: two would drift from Exact's actual row
shapes independently, which is the one thing that file exists to be right
about.

## `tokens.revokeClient`

No endpoint mints an OAuth-issued token — that is the token exchange. The
scenario registers a client through `OAuthRepository` and issues a token
carrying its id, which is the state the exchange produces. Same state,
different route in, and the foreign key on `oauth_client_id` made the first
attempt (a made-up client id) fail rather than pass.

## Completeness is asserted, not counted by hand

`conforms()` records every operation it checks. The last test in the file
compares that set against the manifest and fails with the names of whatever is
missing. There is an `OUT_OF_REACH` map for operations that genuinely cannot be
driven; it is currently empty, and there is a second test that fails if
something in it turns out to be reachable after all — an excuse that has
stopped being true is worse than no excuse, because nobody looks at it again.

The size is asserted too. Two empty sets compare equal, so a regression that
quietly stopped driving the scenario would otherwise pass.

## Consequences

- `response-shapes.test.ts` is long — one file, because the completeness check
  has to see everything `conforms` saw, and vitest workers do not share state
  across files.
- It is also slow-ish (about ten seconds) and it writes a lot: four
  administrations, a dozen documents, a sealed snapshot. `cleanupSeededBackgroundWork`
  takes away what would otherwise give the worker work to do.
- The suite's token holds `['*']`. What a token _may_ do is
  auth-security.test.ts's subject; a missing permission here would be
  indistinguishable from a shape that does not conform.
- `exact.test.ts` lost 350 lines to `test/support/exact-online.ts`.
