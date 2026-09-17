# 0053. A column that finally means something

Status: Accepted
Date: 2026-09-17

## Context

Spec 10.2 asks for `updated_since` on list endpoints, for incremental sync. The
note carried since M6 said the resource lists did not offer it.

Two things turned up before any of it could be built.

## Most lists do not need it

An `updated_since` filter is only meaningful where a row can move after you
last read it. A journal entry never does — it is append-only by trigger, which
is the ledger's central promise — so its existing cursor is already the whole
of "what is new". The same goes for the audit log, the event stream, and
snapshots.

Four resources change in place: **contacts, sales invoices, purchase invoices
and bank transactions**. Those are the four, and the other twenty-three list
endpoints are complete without it.

## The column existed and had never meant anything

All four already had `updated_at`, from the shared `timestamps` builder in
`schema/columns.ts`. Every one of them set it on insert and **nothing ever
bumped it on update**, so since M1 `updated_at` has equalled `created_at` for
every row in the database.

A filter built on that would have been the worst kind of wrong: a successful
response, no error, and the changed row simply absent. A client would mirror
stale data indefinitely and have no way to notice.

It also means the column was invisible to a grep for `updatedAt:` — it arrives
through a spread — which is how the first survey concluded the tables did not
have it at all. The schema said one thing and the behaviour said another, and
only the second was checked.

## A trigger, not repository code

Migration 0029 adds `klopt.touch_updated_at()` and wires it to all four.

Doing it in the repositories would work until the next code path. A repository
that forgets leaves a row that never appears in an incremental sync again, and
nothing fails — no exception, no failing test, just a mirror that is quietly
wrong about one contact. A trigger cannot be forgotten by code written next
year, which is the only guarantee worth having here.

`now()` is transaction-scoped, so every row touched by one transaction shares a
timestamp and a same-transaction update does not advance it past its own
insert. That is correct: one transaction is one instant.

## What it is, and what `/events` is

**This is a filter, not a subscription.** Timestamp cursors have a known skew:
a transaction that starts before your watermark and commits after it writes a
row you will not see again. The window is small and the mitigation is standard
— the comparison is inclusive and a client deduplicates by id — but it is not
zero, and pretending otherwise would be the overclaim that costs somebody a
reconciliation.

`GET /api/v1/events` is the feed with the ordering guarantee, cursor-paged,
gap-free, and `docs/api-stability.md` already promises its ordering. The two
are for different jobs: keep a mirror warm with `updatedSince`, and reconcile
against `/events`. The document says so where an integrator will read it.

## The round trip had to be made to work

`updatedAt` goes out on every row, because without it a client has nothing to
pass back except its own clock — which is not the clock that wrote the row.

The first version of that returned Postgres's own rendering of a timestamptz,
which is not RFC 3339 and which the query schema then rejected. A client
following the obvious loop — read the newest `updatedAt`, pass it as
`updatedSince` — would have got a 422 on its second call. Caught by the test
that does exactly that loop, which is the only reason to write that test.

## Consequences

- Four lists take `updatedSince`; the rest are unchanged.
- `updated_at` is maintained on four tables for the first time. Existing rows
  keep their insert value until they are next touched, which is honest: we do
  not know when they changed.
- An index per table on `(entity_id, updated_at)`, because every list is scoped
  to one entity.
- `purchase_invoices` declares its column in date mode rather than the shared
  builder's string mode, so it converts at two boundaries. Left as it is:
  changing the column's mode is a wider change than this note deserves.
