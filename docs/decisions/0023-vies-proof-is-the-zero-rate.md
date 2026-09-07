# 0023. An unproven VAT number blocks the opgaaf, and an outage is not proof

Status: Accepted
Date: 2026-09-07

## Context

Spec 7.2, on the ICP opgaaf:

> Validate counterparty VAT numbers against VIES, cache results with a
> timestamp, and store the validation proof. Store what VIES said and when,
> because that is your evidence for applying the zero rate.
>
> Cross-check: ICP totals must equal rubriek 3b. Block on mismatch.

Zero-rating an intra-community supply is a claim about somebody else. What
defends it in an audit is not that the number looked right, but that you asked
the Commission's register at the time and it said yes. A boolean that was not
written down defends nothing.

## Decision

**Every check is a row, and rows are never replaced.** `vat_number_checks` is
append-only, enforced by the same trigger the journal uses. A number that was
valid last quarter and is invalid now is two facts, and the older one is what
defends last quarter's zero rate. Overwriting would destroy the only thing worth
keeping.

**The response is stored verbatim.** `raw` is what came back, not what we made
of it. When VIES renames a field, the evidence outlives our parser.

**The requester's own VAT number is part of the request, not configuration.**
VIES returns a `requestIdentifier` — the consultation number — only to a caller
that identifies itself. That identifier is the proof; an anonymous check returns
a valid/invalid answer and nothing showable. So an entity that has not filled in
its own VAT number can get an answer and cannot get proof, and the screen says
so in those words rather than showing a green tick.

**An outage is `unavailable`, and `unavailable` blocks.** This is the decision
with teeth. VIES goes down, member states' registers go down individually, and
the temptation is to treat a non-answer as a pass so the quarter can be filed.
It is not a pass. `MS_UNAVAILABLE` says nothing whatsoever about the number, so
it is recorded as what it is and the opgaaf refuses to file. What it does _not_
do is stop anybody invoicing — spec 8's fourth rule — because the books and the
claim are separate things. The books work; the claim is not yet defensible.

Distinguishing an outage from an invalid number is therefore load-bearing, and
it is the one piece of parsing with its own test: VIES answers `valid: false`
for "not registered" _and_ for "your request was malformed" _and_ for "Germany
did not answer", and only the first is the counterparty's problem. Conflating
them files somebody else's typo as their fault, and they are the one who gets
the letter.

**A proof dated before the period is a warning, not a pass and not a block.** A
number can be deregistered between one quarter and the next, so a check made in
January proves less about a March supply. Warning rather than blocking because
the check _did_ happen and re-running it now would not make it retroactive.

**The default needs no third party and is honest about it.** A fresh install has
no `KLOPT_VIES_ENDPOINT`, and the offline validator checks the shape, records
`unavailable`, and names the environment variable in its own error message. It
never claims `valid`. An install behind an egress filter can therefore still
keep books, still see exactly which numbers are unproven, and still cannot file
an opgaaf it cannot defend — which is the correct outcome, not a degradation.

**A retry replays.** The operation registry refuses a write that is not
idempotent, and it was right to: a client retrying a timeout should not become
two consultations of a shared public register, nor two rows in the evidence
history. The idempotency key is stored on each row of the batch and a repeat
returns the stored answers.

## The counterparty of a supply is a property of the entry

The subledger link sits on the _receivable_ line, which is correct — the debtors
ledger sums by subledger, and tagging both lines would double every balance. But
the ICP opgaaf needs the customer of the supply, and the supply is the revenue
line.

So the counterparty is resolved per journal entry and attached to its lines.
That is how a bookkeeper reads it too: the invoice is the entry, and the entry
has one customer. An entry touching two debtors — a memoriaal moving a balance
between them — resolves to nothing and blocks, because guessing would file
somebody else's turnover under somebody else's VAT number in a return the
Belastingdienst cross-checks against what that customer declared.

A supply whose entry has no customer at all is the single commonest way the
opgaaf and rubriek 3b come apart, so it is reported with the entry named rather
than filtered out of the query.

## What this turned up

The HTTP walk-through found a second shipped bug, this one in M1's e-invoicing.

`tax_codes.ubl_category` was `char(2)`. A UBL category code is one _or_ two
characters — S, Z, E, K, G, O, AE — and Postgres blank-pads `character(n)`, so
every one-letter code came back over the wire as `'S '`. Every UBL invoice
generated from the database since M1 carried `<cbc:ID>S </cbc:ID>`, which is not
a code in UNCL5305 and is what BR-CL-18 exists to catch.

Two things hid it. The UBL golden tests build their fixture by hand rather than
reading it back from a column, so they only ever saw `'S'`. And both `length()`
and a cast to `text` strip the padding, so `psql` prints `S` — only the driver
sees the truth.

Fixed by the column type rather than by trimming on read: a fixed-width type for
a variable-width code is the bug, and a trim in one of six query sites is five
sites away from a fix. Migration 0014, with a check constraint on the shape and
a db-backed test asserting no element in a generated UBL ends in whitespace.

## Consequences

- The Nederlandse Taxonomie and the XBRL instance are still to come, so filing
  is `manual` only: the figures and the reconciliation, for somebody to type
  into Mijn Belastingdienst Zakelijk. That is a first-class path per spec 7.2,
  not a placeholder — but it is not yet the _whole_ manual path, which is meant
  to include the generated instance.
- Nothing in the test suite reaches the real register. The adapter is tested
  against captured response shapes and the handlers against a fake, because
  hitting a public service from CI is rude and flaky.
- `vat_number_checks` will grow without bound. That is intended — it is an
  evidence log — but it is the first table in the system with no natural
  ceiling, and a retention policy will eventually be a real question.
