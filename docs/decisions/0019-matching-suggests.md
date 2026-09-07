# 0019. The matcher suggests, and the confirmation is what teaches it

Status: Accepted
Date: 2026-09-07

## Context

Spec 7.4 asks for a rule layer — "exact match on invoice number or payment
reference, then IBAN plus amount, then fuzzy on name and amount within a
tolerance" — and then for the rest to go "to a suggestion queue with a
confidence score and a one-keystroke confirm", learning from what the human
picks.

The temptation in all of that is automation: match confidently enough and post
without asking. It is the wrong instinct here, and worth writing down why.

## Decision

**Nothing is posted without a human confirming it.** Every layer returns
candidates with a confidence and a reason; `suggestMatches` has no side effects
and no access to anything that could have one.

A wrong automatic match is worse than no match. It clears an invoice that is
still owed, so the customer stops being chased, and the error surfaces months
later as a debtor balance nobody can explain — by which time the statement, the
invoice and the person who could remember are all gone. An unmatched line, by
contrast, sits in a queue being annoying, which is a failure mode that fixes
itself.

**The reason is part of the output, not a debugging aid.** "Factuurnummer
2026-0001 staat in de omschrijving en het bedrag klopt precies" is checkable at
a glance; a bare 99% is not. Spec 7.4 requires learned rules to be "visible and
editable, never a black box", and a suggestion that cannot say why it exists
fails the same test. It is also why the confidence is built from countable
things — does the IBAN match, how many times has this rule been right — rather
than from a score nobody can reconstruct.

**The fuzzy layer only fires when nothing stronger did.** It is the weakest and
most likely to be wrong, and when the IBAN layer has already said "two invoices
have exactly this amount, choose one", a confident guess from a similar name is
worse than the honest ambiguity it would outrank. This was a real bug: the fuzzy
layer scored 75 against the ambiguity's 55 and won.

**Learning happens only where there is something to learn.** A payment quoting
its invoice number teaches nothing, because the next one will quote its own.
What is worth remembering is "money from this account, described like this, goes
to that account" — a subscription, a bank charge, a utility bill. So a
confirmation with an allocation learns nothing, and one without an allocation
learns the counterparty.

Rules are rows with a `source` column, not a model. Every one can be listed,
explained, switched off and deleted, and `times_applied` is both the confidence
input and the honest answer to "why did it suggest that".

**Bank charges are split off, within two bounds at once.** A payment arriving a
few euro short is a cost, not a partial payment, and treating it as one leaves a
debtor open for years. But 15 euro off a 20 euro invoice is not a bank charge
either, so the tolerance is both a ceiling and a proportion — either alone gets
one of those cases wrong.

**An allocation is a row, not a column.** One payment settles several invoices
and one invoice is settled by several payments; spec 7.4 asks for both, and only
a join table can be true. This is also what finally makes "outstanding" mean
something — total less allocations — which every report that asks what is owed
now joins.

## Consequences

The dunning list is correct for the first time. Before this, "overdue" could
only mean "issued and not cancelled", and the screen carried a paragraph saying
so. That paragraph is gone, and the test that proves it is the one that pays an
invoice and asserts it leaves the queue.

Two bugs were caught by writing that test rather than by reading the code, and
both were invisible from the outside:

- `dunnable` did not know about allocations, so a paid invoice was still chased.
  One number with two answers, which is the exact failure the allocation table
  exists to prevent — and it appeared the moment the table did.
- The unique constraint on a rule's condition set used Postgres's default
  `NULLS DISTINCT`. A rule normally has one condition and two nulls, so no two
  rows ever conflicted, so `onConflictDoUpdate` inserted a new rule every time
  and `times_applied` never left 1. The learning worked and the confidence never
  grew.

What is not built: the matching UI beyond the transaction list, so suggestions
and confirmation are API-only for now. The charges account is looked up as
`4900` and charge splitting is simply not offered when a chart does not have it
— that wants to be a per-entity setting, and guessing was the alternative.
Subset-sum over open invoices is not attempted: a batch payment is matched from
the invoice numbers in its description, or allocated oldest-first, both of which
a bookkeeper can check.
