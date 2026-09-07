# 0018. A dunning stage is derived, and a failed send is a record

Status: Accepted
Date: 2026-09-07

## Context

M1's last piece: sending an invoice, and chasing it when nobody pays. Two
questions had to be settled, and both have an obvious wrong answer.

**Where does the dunning stage live?** The obvious answer is a column on
`sales_invoices` — `dunning_stage`, bumped each time a reminder goes out. It is
also wrong: the column and the sending have to be kept in step, and the first
time a send fails halfway they disagree. After that nobody can tell whether the
customer was chased twice or not at all, which is precisely the question the
feature exists to answer.

**What happens when a send fails?** The obvious answer is to throw. Spec 8's
rule 4 says otherwise: "an adapter failing degrades to its fallback with a
visible warning. It never blocks bookkeeping."

## Decision

**The stage is derived, never stored.** `planDunning` in `@klopt/core` takes the
overdue invoices, their delivery history and today's date, and returns at most
one action per invoice. There is no stage column and nothing to keep in step.
Reminders are rows in `invoice_deliveries` — the same table the invoice's own
delivery goes in, because they are the same act — distinguished by `purpose` and
carrying `dunning_stage`.

Three rules fall out of it, and each is a test:

- **One reminder per stage, ever.** A retry after a bounce, or a job that runs
  twice in a day, cannot chase twice: a stage that appears in the history is
  closed whatever happened to the message.
- **One action per invoice per run.** An invoice two months late has three
  stages overdue. It gets the _highest_ one — the schedule already says what
  forty-two days late deserves — not three letters in three days.
- **Never backwards.** Only stages above the highest already sent are
  candidates. Following a final demand with a polite second reminder is what a
  naive set-difference does, and it reads as incompetence.

The schedule is 7, 21 and 42 days, and stops there. Fourteen days after a final
notice a creditor may charge statutory interest and collection costs, which is a
decision for a human and not a scheduler.

**A failed send is recorded and reported, not thrown away.** The delivery row is
written whether or not the message arrived, with the transport's own id and the
failure text. The response is 200 when it went and 502 when it was attempted and
failed — either way the invoice is untouched and there is a row saying what
happened, which is the answer to a customer who says they never got it.

**The stage the caller asked for is checked, not trusted.** A screen open for an
hour would otherwise send a stage-1 courtesy to an invoice that has moved on to
a final demand. `expectedStage` says what the caller thought; a mismatch is a
409 rather than the wrong letter.

**Nothing is sent that has not passed the schematron.** The send path builds its
UBL through the same handler the download uses, so the guarantee from
[0017](0017-schematron-in-process.md) covers sending too — which was the point
of doing schematron before transport rather than after.

## Consequences

One transport ships: email, with the UBL and the PDF attached. That is spec
7.5's fallback and spec 8's rule 1 — the implementation that needs no third
party and is the default in a fresh install. With no SMTP configured the message
goes to a directory or the log and the receipt says `delivered: false`, which is
true and more useful than a queue that silently retries.

A Peppol access point slots in behind the same port. It is absent because it
cannot be built or tested without a service provider agreement and issued
certificates, not because the shape is unclear — and `reachable()` exists on the
port precisely so that choosing the fallback is a decision made before sending
rather than a recovery afterwards.

**"Overdue" still means issued and not cancelled.** Payments arrive in M2, and
until then the dunning list overstates itself for anyone who has paid. The
screen says so in as many words rather than letting somebody discover it by
chasing a customer who paid last week. This is the one place in the product
where a number is knowingly wrong, and it is labelled.
