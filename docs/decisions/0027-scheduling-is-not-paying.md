# 0027. A payment run pays suppliers, not invoices, and scheduling is not paying

Status: Accepted
Date: 2026-09-07

## Context

M4's milestone table says the point of the whole slice is that "the full cycle
closes". Until now it closed in principle: a document arrived, became an
invoice, was booked and authorised — and then somebody typed the supplier's
name and IBAN into a payment batch by hand, from a screen that already knew
both.

This is the step that draws the batch from the approved invoices themselves.

## The unit is the supplier, not the invoice

One payment per invoice is the tempting design. Each one then carries its own
betalingskenmerk, the supplier's own system reconciles it automatically, and
nothing needs netting.

**Credit notes make it impossible.** A supplier who invoiced 1.210,00 and then
credited 210,00 is owed 1.000,00, and there is no such thing as a payment of
minus 210,00 — the credit has to be netted against something before any money
moves. Netting is an operation on a supplier's position, not on a document.

So the unit is the supplier, the amount is what they are net owed, and the
instruction records which documents it settles. `payment_instruction_invoices`
exists for exactly this, and it is what lets a returned payment be traced back
to the invoices it was meant to clear.

The structured reference survives the case where it can. When a supplier is owed
for exactly one invoice, with no credit notes, that invoice's payment reference
goes out as the structured remittance and their system reconciles it without a
human. When several documents are settled at once there is nowhere to put more
than one, so the numbers are listed unstructured — which is what a supplier
statement run looks like everywhere else too.

## An instruction settles every document it netted

The first version allocated the cash across the invoices oldest-first and
stopped when it ran out. It is the obvious reading of "oldest first" and it
overpays.

Two invoices of 100,00 and a credit note of 150,00 is a payment of 50,00. Spend
that 50,00 on the oldest invoice and the second one is still open, so next
week's run pays it in full: 150,00 out the door on 200,00 invoiced less a
150,00 credit. The credit was spent once and counted once, and the second
invoice was never told it had been settled.

So an instruction settles **every** document in the net: the invoices in full,
the credit notes in full, and the difference is the cash. That is what a
positive net means — the credits fit inside the invoices — and it gives an
invariant worth testing directly:

> the sum of an instruction's invoice allocations, less the sum of its credit
> note allocations, is the amount it pays, to the cent.

An allocation that did not hold this would mark an invoice settled for an amount
nobody paid, and the creditors subledger would stop agreeing with account 1600
from that moment.

## Scheduling is not paying

The bug this decision is really about.

`allocatedFor` added two sources together — bank transactions matched to an
invoice, and payment instructions that settle it — under one name, `outstanding`.
Both do make an invoice stop turning up in the next payment run, which is what
the summing was for. But they answer different questions:

- **A matched bank transaction means the money is gone.** The invoice is no
  longer owed, and account 1600 has moved with it.
- **A payment instruction means somebody has scheduled it.** The money is still
  in the account, the supplier is still a creditor, and 1600 has not moved.

Collapsing them meant that preparing a batch silently emptied the creditors
ageing while the control account still carried the liability. The reconciliation
that is supposed to prove the books broke the moment anybody used the feature it
was built alongside. A handler test asking for the ageing after a run is what
found it.

So the two are separate now, and every caller says which it means:

|                                                                           | reduced by                     |
| ------------------------------------------------------------------------- | ------------------------------ |
| `outstanding` — what is owed, what the ageing shows, what 1600 must equal | bank payments                  |
| `unscheduled` — what the next run may pick up                             | bank payments and instructions |

A scheduled invoice stays in the ageing, stays in the reconciliation, and is
marked _ingepland_ on the purchase list so nobody has to wonder why it stopped
appearing in the betaalrun.

## A credit note reduces what is owed

Found by the same test. Amounts are stored unsigned and the journal flips the
sides — a credit note debits 1600 — so the subledger has to flip them back. It
was summing `outstanding` directly, which added a credit note to what was owed
instead of subtracting it, overstating creditors by twice its value and
breaking the reconciliation for any supplier who had ever sent one.

`signedOutstanding` is now what the ageing and the reconciliation use, and the
per-supplier position it produces is the same number the payment run pays.

## A blocked run is refused whole

A supplier with no IBAN, an IBAN that fails its own check digits, or open
documents in another currency than the batch blocks the **entire** run, naming
every blocked supplier at once. Not "pay the ones that are fine": a run that
silently leaves somebody out is a run whose total nobody can check against the
ageing, and the missing supplier is discovered by their dunning letter.

An IBAN is checked here rather than by the bank, which refuses a whole batch for
one bad account and does not say which one.

Two findings are notes rather than blocks, because they are facts about a
supplier rather than problems with the run: credits that cancel the invoices out
exactly (nothing to pay, and nothing wrong), and credits that exceed them (a
refund to ask for, not a transfer to send).

## Consequences

- **Booked-but-unapproved and disputed invoices are not in a run.** `booked` is
  a liability nobody authorised and `disputed` is one somebody is arguing about.
  Both stay in the ageing, per ADR 0025; neither is paid.
- **The second approval still stands.** This writes a draft batch. It goes
  nowhere until it is submitted and approved by a second person, per ADR 0020,
  and only then is there a pain.001.
- **A run drawn from invoices and one typed by hand are the same batch.**
  `Betaling toevoegen` still exists, for the deposit and the tax payment that
  never were purchase invoices.

## Three things this work turned up

**Every IBAN typed into Relaties was thrown away.** The contact form rendered an
IBAN field and never put it in the payload, so no supplier created through the
UI could be paid — the run reported "has no IBAN on file" for a supplier whose
IBAN was on the screen when they were saved. ADR 0025 records adding the field
in the first place; a browser test that went as far as paying is what noticed
nothing had been reading it.

**The payer on every SEPA file was the account's nickname.** `debtorName` came
from `bank_accounts.name`, so a file said the payer was "Rekening-courant".
A bank checks that name against the account holder, and the supplier's statement
shows it — neither of them wants a nickname. It is the entity's legal name now.

**"An invoice that is concept cannot be approveed."** `${action}ed` looks like
it works and produces _approveed_, _disputeed_, _resolveed_. A message somebody
reads has to be written, not assembled. Found by reading the walk-through output
rather than by any test, which is the argument for doing the walk-through.
