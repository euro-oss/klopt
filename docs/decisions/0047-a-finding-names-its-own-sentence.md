# 0047. A finding names its own sentence

Status: Accepted
Date: 2026-09-14

## Context

ADR 0046 translated the domain's 103 refusals and left the findings — the other
thing the domain says to somebody. A finding is not a refusal: it is a purchase
invoice whose lines do not add up, a VAT control account that moved untagged, a
payment run with a supplier who has no IBAN. It is advice, sometimes blocking
and sometimes not, and it was English on a Dutch screen for the same reason the
refusals were.

There are five kinds — `PurchaseFinding`, `VatFinding`, `IcpFinding`,
`PaymentRunFinding`, `InboundFinding` — plus `PaymentProblem`, which is a
finding in all but name. 51 sentences between them.

They also travel further than a refusal. A finding appears on its own screen,
_and_ gets forwarded into a `LedgerViolation` when a check blocks a posting.
ADR 0046 left those eight `forwarded()` sites falling back to English precisely
because the finding had no key to forward.

## The same mechanism, unchanged

`FINDING_MESSAGES` in `@klopt/core`, keyed `<area>.<code>`. Each finding type
gained `messageKey` and `detail`; each builder takes a key and the values
instead of a sentence and renders it. `nl.ts` has the Dutch, `en.ts` spreads
the catalogue rather than restating it, and `test/labels.test.ts` walks the
catalogue so a new finding fails the build until it is translated.

That the design carried over without modification is the useful result. The
only new decision was the suffix rule: `<area>.<code>` unless one code says
more than one thing — a payer and a payee both have an IBAN that can be wrong,
and `payment.invalid_iban.debtor` versus `.creditor` is the difference between
a message that helps and one that does not.

`forwarded()` now takes the finding's key, so a blocked posting shows the same
Dutch sentence the finding screen would have. It still accepts `null`, for the
one source that has no code at all — an XAF problem is a message and a path and
nothing else.

**818 core tests passed unchanged**, which is what says the 51 sentences came
out byte-identical.

## What the script got wrong this time

Fewer than last time, and the same class:

- `purchase.rate_mismatch` and `purchase.pro_rata` both interpolate
  `(share / 100).toFixed(2)`. The namer took the last identifier and produced
  `{toFixed}`. Renamed to `{rate}` and `{share}`.
- `inbound.totals_disagree_with_lines` compares the document's declared total
  against the sum of its lines. Both were `{toFixed}` — the same collision that
  hit the XAF control totals in ADR 0046, which is now twice, so it is a
  property of the heuristic rather than bad luck. `{declared}` and
  `{fromLines}`.
- `payment.invalid_characters` builds its list with a nested template literal
  inside a `.map`, which the extractor could not read. Done by hand, with the
  join lifted into a `characters` variable so the sentence has one placeholder.

Reading the generated catalogue is where all three came from. Fifty-one lines
is still small enough to read.

## Two more findings than the todo list knew about

`InboundFinding` — the UBL parser's nine findings — was not in the note that
started this work. It turned up because `forwarded()` refused to compile
against it. Folded in rather than deferred: it is the same shape, and a
partially translated finding surface is the thing ADR 0045 argues against.

## Consequences

- 51 finding sentences in both languages, enforced from the catalogue.
- The eight `forwarded()` violations translate now. The only remaining fallback
  is XAF, which has no code.
- Findings carry `messageKey` and `detail` on the wire. `message` stays: not
  every client has a catalogue. Fields added, none removed.
- `@klopt/core/findings` is a third browser-safe subpath, next to `./format`
  and `./violations`, for the same reason: `en.ts` reaches the browser bundle
  and the barrel reaches `node:crypto`.
- Two e2e tests had recorded the old English and now record the Dutch.
