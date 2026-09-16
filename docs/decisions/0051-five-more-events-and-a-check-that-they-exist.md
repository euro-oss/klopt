# 0051. Five more events, and a check that they exist

Status: Accepted
Date: 2026-09-16

## Context

Spec 9.3 says every state change emits a versioned event. There were six, and
the note in the todo list said adding more was "one line each at the emit site
plus a catalogue entry".

It was not, for two reasons worth recording.

## Not every write deserves one

Fifty-seven operations are writes. Six events is not obviously too few, and
publishing all fifty-seven would be how an event stream becomes noise nobody
subscribes to — which is the reasoning already written into
`handleTransitionPurchaseInvoice`, where only the approval is published.

The test applied: **is this irreversible, and would a consumer otherwise have
to poll for it?** Five passed.

- `sales.invoice.paid` — a bank line settled an invoice in full. The single
  most-wanted integration fact: dunning stops, a CRM updates.
- `payments.batch.exported` — the pain.001 has been produced. The last moment
  this instance controls.
- `ledger.year.closed` — the books are shut and the result appropriated.
- `compliance.snapshot.sealed` — an archival system wants the hash the moment
  it exists, and "whenever it next looks" is too late to prove anything about
  when.
- `retention.document.deleted` — a destruction is worth recording somewhere
  other than the instance that did it.

### One I planned and dropped

`purchase.invoice.disputed` looked like the obvious counterpart to `approved`,
until the comment above the existing emit turned out to have already decided
it: _"a dispute is a conversation with a supplier, not a fact an integration
acts on"_. That is a considered judgement with a reason, and overturning it in
an add-more-events pass — with no new information — would be second-guessing a
decision rather than making one. Left alone.

## The outbox was never the ledger's

`enqueueEvent` lived on `DrizzleLedgerRepository`, which was fine while the
ledger was the only thing that emitted. Four of the five new events happen in
transactions that have no ledger repository, and the choice was to widen four
unit-of-work wrappers so they all hand out a repository they do not need, or to
admit the outbox belongs to no module.

`enqueueDomainEvent(tx, event)` is a free function now, and the repositories
that emit delegate one line to it. It takes the transaction rather than the
database on purpose: the rule the outbox exists to enforce is that the event is
written in the transaction that made the change, and taking `tx` makes calling
it anywhere else awkward enough to notice.

## The resource has to be dereferenceable

An event is a type and a reference — ADR on the catalogue is explicit that it
carries no payload, so a consumer comes back and asks with their own token.
That constrains what can be an event: there has to be something to ask about.

`retention.documents.deleted`, plural and per-run, had nothing. There is no
run id. The fix was to make it singular and point at the document — which works
precisely because `GET /api/v1/documents/:id` answers **410 Gone** with the
hash and the reason rather than 404. The reference still resolves after the
bytes are destroyed, and what it resolves to is the record an archival system
wanted.

`payments.batch.executed` was renamed to `.exported` for a duller reason: the
state is called `exported`, and an event naming a state the domain does not
have is a small lie that costs somebody an afternoon.

## The check that was missing

`packages/db/test/modules.test.ts` already refuses a catalogue type no module
_declares_. It does not catch the other half — a type declared, documented,
published in `openapi.json`, that no line of code ever writes. A consumer
subscribes to it and waits forever, and nothing fails.

`test/events.test.ts` now reads the source of all three packages and requires
`type: '<name>'` to appear at an emit site for every type in the catalogue,
excluding the catalogue itself so the test cannot agree with itself. Crude, and
the right kind of crude: the question is literally whether that string appears
where events are written, and a cleverer mechanism would need keeping in step
with the emitting.

Adding a type and no emit fails it by name.

## Consequences

- Eleven event types, each with an emit site a test insists on.
- The outbox is reachable from any unit of work, so the next event is the "one
  line at the emit site" the old note claimed.
- `sales.invoice.paid` is emitted by the **bank** module, not sales. Settlement
  is a bank line meeting an invoice, and sales never sees the money arrive; the
  module contract says so.
- Still not "every state change". It is every state change that is irreversible
  and that somebody outside would otherwise poll for, which is the reading of
  spec 9.3 the catalogue has always used and now says out loud.
