# 0020. A payment file needs two people, and neither of them can be a script

Status: Accepted
Date: 2026-09-07

## Context

Spec 7.4: "SEPA `pain.001` batch export for supplier payments, **with a
two-person approval flow**."

A `pain.001` is the only artefact this system produces that moves real money out
of the building. Everything else is a record of something that already
happened; this is an instruction. So the question is not how to generate it —
that is a mapping — but what has to be true before it exists.

## Decision

**Two permissions, and they are different.** `payments:prepare` builds a batch
and submits it; `payments:approve` releases it. A bookkeeper — the heaviest user
of the system — has the first and not the second. A flow where one person holds
both is one person with two clicks.

**The approver must not be the submitter.** That is a rule about _this payment_
rather than about a person, so it lives in `@klopt/core` and is checked against
the `submitted_by` in the database rather than anything the caller says. There
is a matching `CHECK` constraint on the table: belt and braces on purpose,
because this is the one table whose contents move money and a constraint
survives a refactor that loses a call to `nextState`.

**Neither of the two can be a script.** A token is a legitimate caller — a human
working through the API is exactly what principle 3 is about — but approval
requires `actorKind: 'human'`. A scheduled job that approves whatever was
submitted is, again, one person with a cron entry. This is the payments analogue
of [0014](0014-entity-provisioning.md)'s "a token cannot create another
administration".

**The instructions freeze on submission.** An approver who approves a batch that
then changes has approved nothing. A rejected batch goes back to draft; an
approved one does not, because withdrawing an approval is itself an approval
decision and therefore a rejection. Reopening clears `submitted_by` and
`approved_by` — otherwise a second submit-approve cycle inherits the first's
approver and the same person could do both halves across the two.

**Downloading the file and marking the batch exported are separate.** The
download is a read and can happen twice, because a download that failed halfway
is a download. Exporting is a state change and happens once, so "did we already
send this to the bank?" stays answerable. A `GET` that mutated would make it
unanswerable.

**Validation is ours, because there is no schema to lean on.** Unlike XAF and
UBL there is no XSD in the repository: ISO 20022 publishes its schemas behind
registration and their redistribution terms are not settled, so vendoring one
would repeat the question [0011](0011-rgs-as-reference-data.md) already has
open. `validatePaymentBatch` carries the weight instead — and it checks the
**IBAN check digits**, which no XSD would have caught and which is the commonest
reason a bank rejects an entire batch for one bad account. The golden-file test
validates against a schema _if_ an operator has put one in
`reference-data/pain/`, the same shape as the existing `xmllint` guard.

The message version is `pain.001.001.03`, not the newer `.09`. A file the bank
refuses to open is worth nothing, and `.03` is what Dutch banks still accept and
what the EPC implementation guidelines were written against. The namespace is
the only difference, so it is a parameter.

## Consequences

A self-hoster can pay their suppliers: build a batch, have somebody else
approve it, download the file, upload it to the bank. What populates a batch
today is manual entry, because purchase invoices are M4 — the batch is the
part that needs the control, and the part that fills it can arrive later
without changing any of this.

`submitted_by` and `approved_by` are actor ids with **no foreign key**, for the
same reason `audit_log.actor_id` has none: an actor is not always a row in
`users`. They started out as foreign keys, which made submitting a batch with a
token a 500 — found by walking the flow over HTTP rather than by a test, because
every test used a real session. There is now a test that uses a token, so it
cannot come back.

What is not built: a screen. The whole flow is API-only, which for a control
this deliberate is the wrong way round — the two people are the point and
neither of them should need `curl`. That is the next thing.
