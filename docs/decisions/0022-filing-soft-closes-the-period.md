# 0022. Filing soft-closes the period, and a correction is a suppletie

Status: Accepted
Date: 2026-09-07

## Context

Spec 7.2 gives two requirements that pull against each other:

- "Lock the period on filing."
- "Support suppletie for corrections to filed periods."

A correction to a filed period means posting into a period that has been
locked. So "lock" cannot mean "seal".

There is a third requirement in the same paragraph that decides how: the return
is derived from the journal on every read. That means a correction posted after
filing silently changes what the return says — and the only way to notice is to
keep what was declared and compare.

## Decision

**Filing soft-closes every period the declaration covers.** Not a hard close:
`hard_closed` is absolute and enforced by a trigger, which would make a
suppletie impossible without a reopen mechanism, and a reopen mechanism is a
way to unlock a sealed period that exists forever afterwards. `soft_closed`
means "only the accountant", which is the right authority for a correction to a
period the Belastingdienst has already been told about. The bookkeeper's
routine posting stops, which is what the lock is for.

**A filing stores what was declared, not a pointer to a recomputation.** The
rubrieken, the reconciliation and the findings go into `vat_filings` as JSON.
They are evidence: the shape they had at filing time is the shape that must come
back, even after the domain model around them has moved on.

**A suppletie is a new row, and it supersedes.** Filings for one period are
numbered — 1 is the original aangifte, 2 the first suppletie — and the previous
one is marked `superseded` rather than updated. Reading a filed period compares
the snapshot against a fresh computation and reports the differences per box,
which is how "this needs a suppletie" gets noticed rather than discovered in an
audit.

**Filing the same figures twice is refused.** If nothing has changed there is
nothing to correct, and a suppletie declaring exactly what was already declared
is noise in the evidence chain.

## Blocking versus accepting

Blocking findings cannot be filed over. That is what makes them blocking, and
the spec is explicit: any difference in the reconciliation is blocking.

Warnings can, by somebody who says so **and says why**, and the reason is stored
with the filing. The reason this is not a refusal is that the commonest warning
is legitimate: paying the previous quarter's aangifte moves a VAT control
account with no tax code on it, and so does VAT booked by hand. The system
cannot tell those apart, and neither should it pretend to — it names the lines
and asks.

`vat:file` is its own permission, held by the owner and the accountant and not
by the bookkeeper. Filing is a statement to the tax authority in the entity's
name; the person posting a hundred entries a day is not the person who should be
making it. A bookkeeper prepares the return and reads its reconciliation with
`ledger:read`, which is the whole screen minus the button.

## Consequences

- A period can be soft-closed by filing and there is still no _manual_ period
  close operation. That gap is now visible: filing is the only thing that
  closes a period, which is not right for a year close.
- The three `FilingTransport` implementations (Digipoort, an SBR provider,
  manual) are recorded on the filing but only `manual` is implemented — it
  stores the reference the operator got from Mijn Belastingdienst Zakelijk. That
  is deliberate ordering, not an oversight: spec 7.2 says the manual path "must
  be a first-class, well-documented flow", and it is the one that needs no
  PKIoverheid certificate.
- The XBRL instance is not generated yet, so `manual` currently means "here are
  the figures" rather than "here is the instance plus a summary". The Nederlandse
  Taxonomie is versioned reference data selected by reporting period, and it
  loads through the same store as RGS.
